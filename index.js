'use strict';
/*
 wn publish 命令
 参数：
 设置customUrl，inner，outer，doc，prepare四个参数
 -c --customUrl <url>可以设置publish的目标源为自定义平台
 -i --inner设置发布到内网平台，spm.woniu.com
 -o --outer设置发布到外网平台，spmjs.io
 -d --doc设置只发布doc，不发布该模块
 -p --prepare设置只生成package.json和readme
 流程：
 1.首先判断该目录有没有package.json，如果有则说明该模块是从spm平台安装的模块，
 如果没有则开始询问模块名，描述，版本号，和依赖情况，模块类型（组件，css，js）生成一个默认的package.json
 2.如果模块类型是组件，拷贝该目录到C:\Users\用户名\AppData\Local\.wn-tmp\www临时目录/wn-publish-tmp/spm_modules，同时从snail-team/wn-module-demo/下载demo页面的模板文件到www临时目录/wn-publish-tmp/，然后在www临时目录/wn-publish-tmp/运行wn release，生成到待上传模块目录的demo/目录里
 3.在该目录运行spm install，spm doc build，和spm doc publish，如果--doc参数不存在则再运行spm publish

 * */
var exec = require('child_process').exec,
//rd = require('rd'),
    child;
var root=fis.util.realpath(process.cwd());
var rootPathInfo=fis.util.pathinfo(root);
var parsedRootPath=parsePath(root);
var wwwTmpRoot=fis.project.getTempPath('www');
var fs=require('fs');
var fse = require('fs-extra');
var inquirer = require("inquirer");
var Download = require('download');
var progress = require('download-status');


exports.name = 'publish';
exports.usage = '[options]';
exports.desc = 'publish package';
exports.register = function (commander){
    commander
        .option('-c, --customUrl <url>', 'publish to custom url, eq: http://spm.yearn.cc', String, 'http://spm.woniu.com')
        .option('-i, --inner', 'publish to inner http://spm.woniu.com', String, 'http://spm.woniu.com')
        .option('-o, --outer', 'publish to outer http://spmjs.io', String, 'http://spm.alipay.im')
        .option('-d, --doc','publish doc only', Boolean, true)
        .option('-p, --prepare','ohly prepare publish package.json and readme', Boolean, true)
        .on('--help', function(){
            console.log('   Examples:'.blue.bold);
            console.log('');
            console.log('   $ '+'wn publish'.blue.bold+' -d');
            console.log('   $ '+'wn publish'.blue.bold+' -c http://spm.xxx.com');
            console.log('');
        })
        .action(function () {

            var packageJsonPath='./package.json';
            var fisConfPath='./fis-conf.js';
            var readMeFile='./README.md';
            var options = arguments[arguments.length - 1];
            //通过参数配置上传网址
            if(options.inner||options.outer||options.customUrl){
                child = exec('spm config set registry '+(options.inner||options.outer||options.customUrl),
                    function (error, stdout, stderr) {
                        console.log(stdout);
                        console.log(stderr);
                        if (error !== null) {
                            console.log('exec error: ' + error);
                        }else{
                            if(!fs.existsSync(packageJsonPath)){
                                //如果没有预置的package.Json,输出一个
                                inquirer.prompt([
                                    {
                                        type:'input',
                                        name:'moduleName',
                                        message:'模块名称是（不能有中文）?',
                                        default:parsedRootPath.name,//默认为文件名
                                        validate:function(projectName){
                                            if(/^[\u2E80-\u9FFF]+$/g.test(projectName)){
                                                //如果有汉字
                                                return false;
                                            }
                                            return true;
                                        }
                                    },
                                    {
                                        type:'input',
                                        name:'moduleDescription',
                                        message:'模块描述？',
                                        default:parsedRootPath.name
                                    },
                                    {
                                        type:'input',
                                        name:'moduleVersion',
                                        message:'版本号?',
                                        default:parsedRootPath.version?parsedRootPath.version:'0.0.1'
                                    },
                                    {
                                        type:'list',
                                        name:'moduleType',
                                        message:'模块类型是?',
                                        default:'js',
                                        choices:['组件','css','js']
                                    },
//                                    {
//                                        type:'input',
//                                        name:'moduleMain',
//                                        message:'模块主入口文件是?',
//                                        default:'index.js'
//                                    },
                                    {
                                        type:'input',
                                        name:'moduleDeps',
                                        message:'依赖哪些模块?',
                                        default:''
                                    }
                                ], function( answers ) {

                                    ensureReadMeFile(readMeFile,answers);
                                    fse.outputJsonSync(packageJsonPath, {
                                        name: answers.moduleName,
                                        version:answers.moduleVersion,
                                        description: answers.moduleDescription,
                                        keywords: [
                                            answers.moduleName,
                                            answers.moduleDescription
                                        ],
                                        homepage: "",
                                        author: "snail-team",
                                        spm:{
                                            main:'',//为了解决spm doc会编译main文件因为wn语法报错问题，故设为空，answers.moduleMain
                                            type:answers.moduleType,
                                            dependencies:cwdToObj(answers.moduleDeps),
                                            devDependencies: {
                                                "expect.js": "0.3.1"
                                            }
                                        }
                                    });

                                    if(answers.moduleType=='组件'){
                                        if(!options.prepare){//如果prepare参数不存在则执行publish
                                            generateDemoAndPublish(answers);
                                        }
                                    }else{
                                        if(!options.prepare){//如果prepare参数不存在则执行publish
                                            publish();
                                        }
                                    }
                                });

                            }else{
                                //有预置的package.json

                                var packageJson=fse.readJsonSync(packageJsonPath);
                                ensureReadMeFile(readMeFile,{moduleName:packageJson.name,moduleVersion:packageJson.version});

                                if(!packageJson.spm.type){
                                    inquirer.prompt([
                                        {
                                            type:'list',
                                            name:'moduleType',
                                            message:'模块类型是?',
                                            default:'js',
                                            choices:['组件','css','js']
                                        }
                                    ], function( answers ) {
                                        packageJson.spm.type=answers.moduleType;

                                        //将spm.dependencies改动写入packageJson
                                        fse.writeJsonSync(packageJsonPath, packageJson);

                                        if(answers.moduleType=='组件'){
                                            if(!options.prepare){//如果prepare参数不存在则执行publish
                                                generateDemoAndPublish({moduleName:packageJson.name,moduleVersion:packageJson.version});
                                            }
                                        }else{
                                            if(!options.prepare){//如果prepare参数不存在则执行publish
                                                publish();
                                            }
                                        }

                                    });
                                }else if(packageJson.spm.type=='组件'){
                                    if(!options.prepare){//如果prepare参数不存在则执行publish
                                        generateDemoAndPublish({moduleName:packageJson.name,moduleVersion:packageJson.version});
                                    }
                                }else if(packageJson.spm.type!='组件'){
                                    if(!options.prepare){//如果prepare参数不存在则执行publish
                                        publish();
                                    }
                                }

                            }
                        }
                    });
            }

            function ensureReadMeFile(file,answers){
                /*
                 保证readme文件的存在，存在则替换里面的name和version变量，不存在则创建一个readme文件
                 */
                //var stat = fs.lstatSync(file);

                if(fs.existsSync(file)){
                    var content=fs.readFileSync(file,'utf8');
                    if(typeof content == 'object'){
                        content=JSON.stringify(content);
                    }
                    content=content.replace(/\<\%name\%\>/g,answers.moduleName);
                    content=content.replace(/\<\%version\%\>/g,answers.moduleVersion);

                    fs.writeFileSync(file,content,'utf8');
                }else{
                    fs.writeFileSync(file, '# '+answers.moduleName+'\r\n'+answers.moduleName,'utf8');
                }
            }
            function generateDemoAndPublish(answers){
                //console.log(wwwTmpRoot);
                //删除demo缓存文件，以免另一个组件生成demo，文件污染
                fse.removeSync(wwwTmpRoot+'/wn-publish-tmp/');
                fse.removeSync('./demo/');
                fse.removeSync('./_site/');
                fse.removeSync('./spm_modules/');

                var targetDir=wwwTmpRoot+'/wn-publish-tmp/spm_modules/'+answers.moduleName+'/'+answers.moduleVersion;
                //console.log(targetDir);
                fse.ensureDir(targetDir, function(err) {
                    if(err){
                        console.log(err); // => null
                    }
                    process.chdir(wwwTmpRoot+'/wn-publish-tmp/');
                    //拷贝模块的package.json文件到wwwTmpRoot+'/wn-publish-tmp/'
                    fse.copy(root+'/package.json', wwwTmpRoot+'/wn-publish-tmp/package.json', function(err) {
                        if (err) return console.error(err);
                        //从wn-data下载view模板和配置文件、package.json文件到wwwTmpRoot+'/wn-publish-tmp/
                        console.log('请稍等，正在下载demo模板...');
                        var download = new Download({ extract: true, strip: 1, mode: '755' })
                            //'https://codeload.github.com/snail-team/' +projectAlias[answers.gameType] + '/tar.gz/master'
                            //'https://github.com/snail-team/'+projectAlias[answers.gameType]+'/archive/master.zip'
                            //'https://raw.githubusercontent.com/scrat-team/scrat.js/master/scrat.js'
                            .get('https://github.com/snail-team/wn-module-demo/archive/master.zip')
                            .dest('./')
                            .use(progress());

                        download.run(function (err, files, stream) {
                            if (err) {
                                throw err;
                            }
                            console.log('demo模板已下载完毕!');
                            //执行模板变量替换
                            var viewsFile=wwwTmpRoot+'/wn-publish-tmp/views/index.html';
                            var stat = fs.lstatSync(viewsFile);
                            if(stat.isFile()){
                                var content=fs.readFileSync(viewsFile,'utf8');
                                if(typeof content == 'object'){
                                    content=JSON.stringify(content);
                                }
                                content=content.replace(/\<\%name\%\>/g,answers.moduleName);
                                content=content.replace(/\<\%version\%\>/g,answers.moduleVersion);

                                fs.writeFileSync(viewsFile,content,'utf8');
                            }
                            var fisConfContent;
                            if(options.inner){
                                fisConfContent=fs.readFileSync(fisConfPath,'utf-8');
                                fisConfContent=fisConfContent.replace(/http\:\/\/spm\.woniu\.com/g,options.inner);
                                fs.writeFileSync(fisConfPath,fisConfContent,'utf-8');
                            }
                            if(options.outer){
                                fisConfContent=fs.readFileSync(fisConfPath,'utf-8');
                                fisConfContent=fisConfContent.replace(/http\:\/\/spm\.woniu\.com/g,options.outer);
                                fs.writeFileSync(fisConfPath,fisConfContent,'utf-8');
                            }
                            if(options.customUrl){
                                fisConfContent=fs.readFileSync(fisConfPath,'utf-8');
                                fisConfContent=fisConfContent.replace(/http\:\/\/spm\.woniu\.com/g,options.customUrl);
                                fs.writeFileSync(fisConfPath,fisConfContent,'utf-8');
                            }

                            //安装依赖到wwwTmpRoot+'/wn-publish-tmp/目录里，以便release的是完整的demo
                            child = exec('spm install',
                                function (error, stdout, stderr) {
                                    console.log(stdout);
                                    console.log(stderr);
                                    //依赖模块安装完成后再release
                                    fse.copy(root, targetDir, function(err) {
                                        if (err) return console.error(err);
                                        console.log("开始生成demo！");
                                        //process.chdir(wwwTmpRoot+'/wn-publish-tmp/');
                                        child = exec('wn release -cDo -d '+root,
                                            function (error, stdout, stderr) {
                                                console.log(stdout);
                                                console.log(stderr);

                                                if (error !== null) {
                                                    console.log('exec error: ' + error);
                                                }else{
                                                    publish();
                                                    console.log("demo生成成功！");
                                                }

                                            });
                                    });
                                    if (error !== null) {
                                        console.log('exec error: ' + error);
                                    }
                                });

                        });
                    });

                });
            }
            function publish(){
                //开始生成doc，切换至根目录
                console.log("开始生成doc！");
                process.chdir(root);
                //删除demo缓存文件，以免另一个组件生成demo，文件污染
                fse.removeSync(wwwTmpRoot+'/wn-publish-tmp/');
                child = exec('spm install',
                    function (error, stdout, stderr) {
                        console.log(stdout);
                        console.log(stderr);
                        child = exec('spm doc build',
                            function (error, stdout, stderr) {
                                console.log(stdout);
                                console.log(stderr);
                                child = exec('spm doc publish',
                                    function (error, stdout, stderr) {
                                        console.log(stdout);
                                        console.log(stderr);

                                        //最好删除spm_modules，不然感觉doc的生成，有点污染源目录,最后上传该模块
                                        if(!options.doc){//如果doc参数不存在则执行spm publish
                                            fse.removeSync('./demo/');
                                            fse.removeSync('./_site/');
                                            fse.removeSync('./spm_modules/');
                                            child = exec('spm publish',
                                                function (error, stdout, stderr) {
                                                    console.log(stdout);
                                                    console.log(stderr);

                                                    if (error !== null) {
                                                        console.log('exec error: ' + error);
                                                    }else{
                                                        console.log("spm publish成功！");
                                                    }
                                                });
                                        }

                                        if (error !== null) {
                                            console.log('exec error: ' + error);
                                        }else{
                                            console.log("spm doc publish成功！");
                                        }
                                    });
                                if (error !== null) {
                                    console.log('exec error: ' + error);
                                }else{
                                    console.log("spm doc build成功！");
                                }
                            });
                        if (error !== null) {
                            console.log('exec error: ' + error);
                        }else{
                            console.log("模块依赖安装成功！");
                        }
                    });
            }
            function cwdToObj(deps){
                //jquery@1.8.3 nav@0.0.2
                var depsObj={},
                    tmpArr=deps.split(' ');
                for(var i=0;i<tmpArr.length;i++){
                    var module=tmpArr[i];
                    if(module&&module!=''){
                        var moduleName,moduleVersion;
                        if(/@/g.test(module)){
                            moduleName=module.split('@')[0];
                            moduleVersion=module.split('@')[1];
                            depsObj[moduleName]=moduleVersion;
                        }else{
                            moduleName=module;
                            moduleVersion='stable';
                            depsObj[moduleName]=moduleVersion;
                        }

                    }
                }
                return depsObj;//{jquery:'1.8.3',nav:'0.0.2'}
            }
            function initPackageJson(answers){
                //写一个spm发布用的package.json
                console.log('开始生成初始package.json！');

                if(!fs.existsSync(packageJson)){
                    //如果没有预置的package.Json,输出一个
                    fse.outputJsonSync(packageJson, {name: answers.projectName});
                }

            }
        });
};
function parsePath(path){
    //判断模块的模块名和版本号情况
    //D:/senro/senro/git/company/wn/wn-site/spm_modules/wn-9yin-nav/0.0.6
    var tmpPath=path.split('/');
    if(/[0-9]*\.[0-9]*\.[0-9]*/g.test(tmpPath[tmpPath.length-1])){
        //最后的名字是版本号，说明这是个从spm_modules安装的模块
        return {name:tmpPath[tmpPath.length-2],version:tmpPath[tmpPath.length-1]};
    }else{
        //最后的名字不是版本号，说明这是个本地模块
        return {name:tmpPath[tmpPath.length-1],version:''};
    }

}
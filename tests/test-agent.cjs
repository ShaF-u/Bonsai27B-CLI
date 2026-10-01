const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Workspace,commandRisk,run,detectEditors,parseAction,buildCommand,summarizeBuild,createProject}=require('../scripts/agent-core.cjs');
test('workspace edit, backup, traversal, unique replacement',()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'bonsai-test-'));
 try{
 const root=path.join(tmp,'project');fs.mkdirSync(root);
 const ws=new Workspace(root,path.join(tmp,'backups'));
 ws.write('Assets/Test.cs','// 日本語\nold');
 const saved=ws.replace('Assets/Test.cs','old','new');
 assert.equal(ws.read('Assets/Test.cs'),'// 日本語\nnew');
 assert.equal(fs.readFileSync(saved.backup,'utf8'),'// 日本語\nold');
 assert.throws(()=>ws.replace('Assets/Test.cs','missing','x'));
 for(const bad of ['../outside','C:\\outside','.git/config','file:stream','CON','a.'])assert.throws(()=>ws.write(bad,'x'));
 fs.mkdirSync(path.join(tmp,'outside'));
 fs.symlinkSync(path.join(tmp,'outside'),path.join(root,'linked'),'junction');
 assert.throws(()=>ws.write('linked/file','x'));
 ws.write('repeat','x x');assert.throws(()=>ws.replace('repeat','x','z'));
 assert.equal(ws.list()[0].name,'Assets');
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
test('commands inside the workspace are auto-approved, outside ones are flagged',()=>{
 const root='C:\\Work\\My Game';
 for(const ok of ['msbuild Game.sln /m','.\\bin\\x64\\Debug\\Game.exe','Remove-Item -Recurse obj','Get-ChildItem -Recurse src | Select-String foo',
   'dotnet build','& "C:\\Work\\My Game\\bin\\Game.exe"','Copy-Item a.txt b.txt; git status','git commit -m "fix"'])
  assert.equal(commandRisk(ok,root),null,ok);
 for(const bad of ['Remove-Item ..\\other','Remove-Item C:\\Windows\\x','Get-Content C:\\Work\\My Gamer\\a','cd C:\\','Get-Content $env:USERPROFILE\\x',
   'Remove-Item ~\\Documents','iwr https://x','git push','Set-ItemProperty HKCU:\\x','Start-Process cmd -Verb RunAs','[IO.File]::Delete("x")','Remove-Item D:','\\\\server\\share\\x','npm install'])
  assert.notEqual(commandRisk(bad,root),null,bad);
});
test('command output and failing exit code are preserved',async()=>{
 const result=await run("Write-Output 'hello'; exit 7",__dirname);
 assert.equal(result.exitCode,7);assert.match(result.output,/hello/);
 assert.match((await run("Write-Output '日本語'",__dirname)).output,/日本語/);
 const parseError=await run('cd x && y',__dirname);
 assert.notEqual(parseError.exitCode,0);assert.doesNotMatch(parseError.output,/�/);
});
test('Visual Studio 2022 tools are detected on this PC',()=>{
 const editors=detectEditors();assert.ok(editors.visualstudio);assert.ok(editors.msbuild);
});

test('folder creation, copy, rename, recoverable deletion and rejection',()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'bonsai-operations-'));
 try {
  const root=path.join(tmp,'project');fs.mkdirSync(root);
  const ws=new Workspace(root,path.join(tmp,'backup'));
  ws.mkdir('empty/nested');assert.ok(fs.statSync(path.join(root,'empty/nested')).isDirectory());
  ws.write('src/code.txt','日本語');
  ws.transfer('src','copy',true);assert.equal(ws.read('copy/code.txt'),'日本語');
  ws.transfer('copy','renamed');assert.ok(!fs.existsSync(path.join(root,'copy')));
  assert.throws(()=>ws.transfer('src','renamed'));
  assert.throws(()=>ws.transfer('src','src/nested',true));
  assert.throws(()=>ws.trash('.'));
  const deleted=ws.trash('renamed');
  assert.equal(fs.readFileSync(path.join(deleted.backup,'code.txt'),'utf8'),'日本語');
  assert.ok(!fs.existsSync(path.join(root,'renamed')));
  fs.mkdirSync(path.join(root,'src','.git'));
  assert.throws(()=>ws.trash('src'));
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});

test('model output repair: raw newlines, fences, prose',()=>{
 assert.equal(parseAction('{"action":"write","content":"a\nb"}').content,'a\nb');
 assert.equal(parseAction('修正します。\n```json\n{"action":"read","path":"x"}\n```').path,'x');
 assert.equal(parseAction('{"action":"write","content":"say \\"hi\\"\n"}').content,'say "hi"\n');
 assert.equal(parseAction('{"action":"write","path":"a","content":"x\\n"').content,'x\n');
 assert.throws(()=>parseAction('no json here'));
 assert.throws(()=>parseAction('{"path":"x"}'));
});

test('identical replacement is rejected without writing',()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'bonsai-noop-'));
 try{
  const root=path.join(tmp,'p');fs.mkdirSync(root);
  const ws=new Workspace(root,path.join(tmp,'b'));
  ws.write('a.txt','same');
  assert.throws(()=>ws.replace('a.txt','same','same'),/identical/);
  ws.write('b.txt','x\nx');assert.throws(()=>ws.replace('b.txt','x','y'),/occurs 2 times/);
  assert.throws(()=>ws.replace('b.txt','z','y'),/not found/);
  assert.equal(fs.readdirSync(path.join(tmp,'b')).length,0);
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});

test('build summary keeps compiler errors only',()=>{
 const r=summarizeBuild({exitCode:1,output:'start\r\nHello.cs(3,5): error CS1002: ; expected [x.proj]\r\nHello.cs(3,5): error CS1002: ; expected [x.proj]\r\nfoo.cs(1,1): warning CS0168: unused\r\ndone'});
 assert.equal(r.succeeded,false);assert.deepEqual(r.errors,['Hello.cs(3,5): error CS1002: ; expected [x.proj]']);assert.equal(r.warningCount,1);
 assert.throws(()=>buildCommand({},path.join(os.tmpdir(),'readme.txt')),/Unsupported/);
});

test('MSBuild build action compiles, reports errors, and msbuild is on PATH',async()=>{
 const editors=detectEditors();
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'bonsai-build-'));
 try{
  fs.writeFileSync(path.join(tmp,'Build.proj'),'<Project><Target Name="Build"><Csc Sources="Hello.cs" OutputAssembly="Hello.exe" TargetType="Exe"/></Target></Project>');
  fs.writeFileSync(path.join(tmp,'Hello.cs'),'class P{static void Main(){System.Console.WriteLine("Bonsai build OK");}}');
  const toolPath=[path.dirname(editors.msbuild)];
  const ok=summarizeBuild(await run(buildCommand(editors,path.join(tmp,'Build.proj')).command,tmp,300000,toolPath));
  assert.ok(ok.succeeded,JSON.stringify(ok));
  assert.match((await run('./Hello.exe',tmp)).output,/Bonsai build OK/);
  fs.writeFileSync(path.join(tmp,'Hello.cs'),'class P{static void Main(){int x=}}');
  const bad=summarizeBuild(await run(buildCommand(editors,path.join(tmp,'Build.proj')).command,tmp,300000,toolPath));
  assert.equal(bad.succeeded,false);assert.match(bad.errors[0],/Hello\.cs\(\d+,\d+\): error CS/);
  const lines=summarizeBuild(await run(buildCommand(editors,path.join(tmp,'Build.proj')).command,tmp,300000,toolPath),tmp).errorLines;
  assert.equal(lines[0].file,'Hello.cs');assert.match(lines[0].text,/int x=/);
  assert.equal((await run('msbuild -version -nologo',tmp,60000,toolPath)).exitCode,0);
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});

test('new_project creates Visual Studio solutions that build and run',async()=>{
 const editors=detectEditors();
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'bonsai project '));
 try{
  const root=path.join(tmp,'work');fs.mkdirSync(root);
  const ws=new Workspace(root,path.join(tmp,'b'));
  const toolPath=[path.dirname(editors.msbuild)];
  for(const [template,expected] of [['console',/Hello, World!/],['cpp-console',/Hello, World!/],['winforms'],['cpp-windows'],['wpf']]) {
   const name='App_'+template.replace('-','_');
   const created=await createProject(ws,editors,{template,name,path:'apps'});
   assert.equal(created.solution,path.join('apps',name,name+'.sln'));
   const build=summarizeBuild(await run(buildCommand(editors,path.join(root,created.solution)).command,root,600000,toolPath),root);
   assert.ok(build.succeeded,template+' '+JSON.stringify(build));
   assert.ok(fs.existsSync(path.join(root,created.debugExecutable)),template+' '+created.debugExecutable);
   if(expected)assert.match((await run('& '+JSON.stringify(path.join(root,created.debugExecutable)),root)).output,expected);
  }
  const lib=await createProject(ws,editors,{template:'classlib',name:'Core',solution:path.join('apps','App_console','App_console.sln')});
  assert.equal(lib.debugExecutable,undefined);
  assert.match(fs.readFileSync(path.join(root,'apps','App_console','App_console.sln'),'utf8'),/Core\.csproj/);
  await assert.rejects(createProject(ws,editors,{template:'console',name:'App_console',path:'apps'}),/already exists/);
  await assert.rejects(createProject(ws,editors,{template:'console',name:'bad name'}),/identifier/);
  await assert.rejects(createProject(ws,editors,{template:'unknown',name:'X'}),/template must be/);
  await assert.rejects(createProject(ws,{},{template:'console',name:'X'}),/\.NET SDK not found/);
  await assert.rejects(createProject(ws,{},{template:'cpp-console',name:'X'}),/C\+\+ tools not found/);
  await assert.rejects(createProject(ws,editors,{template:'console',name:'X',path:'../outside'}),/Outside workspace/);
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});

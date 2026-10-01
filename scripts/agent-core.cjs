'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
class Workspace {
  constructor(root, state) {
    this.root = fs.realpathSync(root);
    this.state = path.resolve(state);
    fs.mkdirSync(state, {recursive:true});
  }
  resolve(name='.') {
    if (typeof name !== 'string' || name.includes(':') || path.isAbsolute(name)) throw Error('Use a relative workspace path.');
    const target = path.resolve(this.root, name);
    if(target===this.state||target.startsWith(this.state+path.sep))throw Error('Agent backups are protected.');
    const rel = path.relative(this.root, target);
    if (rel === '..' || rel.startsWith('..'+path.sep) || path.isAbsolute(rel)) throw Error('Outside workspace.');
    let current = this.root;
    for (const part of rel.split(path.sep).filter(Boolean)) {
      if (['.git','.bonsai-agent'].includes(part.toLowerCase())) throw Error('Protected directory.');
      if (/[<>:"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i.test(part)) throw Error('Invalid Windows path.');
      current = path.join(current,part);
      if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw Error('Links/junctions are not supported.');
    }
    return target;
  }
  list(name='.') {
    return fs.readdirSync(this.resolve(name), {withFileTypes:true})
      .filter(x=>!['.git','.bonsai-agent','node_modules','Library','Temp','obj','bin','Intermediate','Binaries','Saved'].includes(x.name))
      .slice(0,200).map(x=>({name:x.name,directory:x.isDirectory()}));
  }
  read(name) {
    const target=this.resolve(name);
    if (fs.statSync(target).size>200000) throw Error('File too large; use a command to inspect a section.');
    const b=fs.readFileSync(target);
    if(b.includes(0)) throw Error('Binary/UTF-16 file: convert explicitly before editing.');
    return b.toString('utf8');
  }
  write(name, content) {
    if(typeof content!=='string'||Buffer.byteLength(content)>200000) throw Error('Invalid/oversized content.');
    const target=this.resolve(name);
    if(target===this.root) throw Error('A filename is required.');
    let backup=null;
    if(fs.existsSync(target)) {
      if(!fs.statSync(target).isFile()) throw Error('Not a file.');
      backup=path.join(this.state,Date.now()+'-'+require('node:crypto').randomUUID()+'.bak');
      fs.copyFileSync(target,backup);
    }
    fs.mkdirSync(path.dirname(target),{recursive:true});
    this.assertInside(path.dirname(target));
    fs.writeFileSync(target,content,'utf8');
    return {saved:name,backup};
  }
  // Re-check after creation: a junction could appear between resolve() and the write.
  assertInside(dir) {
    const real=fs.realpathSync(dir);
    if(real!==this.root&&!real.startsWith(this.root+path.sep))throw Error('Outside workspace.');
  }
  mkdir(name) {
    const target=this.resolve(name);
    fs.mkdirSync(target,{recursive:true});
    this.assertInside(target);
    return {created:name};
  }
  tree(target) {
    if(this.state===target||this.state.startsWith(target+path.sep))throw Error('Directory contains active agent backups.');
    if(fs.lstatSync(target).isSymbolicLink())throw Error('Links/junctions are not supported.');
    this.resolve(path.relative(this.root,target));
    if(fs.statSync(target).isDirectory())
      for(const name of fs.readdirSync(target))this.tree(path.join(target,name));
  }
  transfer(source,destination,copy=false) {
    const from=this.resolve(source),to=this.resolve(destination);
    if(from===this.root||to===this.root)throw Error('Workspace root cannot be moved or copied.');
    this.tree(from);
    if(fs.existsSync(to))throw Error('Destination already exists.');
    if(to.startsWith(from+path.sep))throw Error('Destination is inside source.');
    fs.mkdirSync(path.dirname(to),{recursive:true});
    if(copy)fs.cpSync(from,to,{recursive:true,errorOnExist:true,force:false});
    else fs.renameSync(from,to);
    return {source,destination,operation:copy?'copy':'move'};
  }
  trash(name) {
    const target=this.resolve(name);
    if(target===this.root)throw Error('Workspace root cannot be deleted.');
    this.tree(target);
    const backup=path.join(this.state,'deleted-'+require('node:crypto').randomUUID());
    fs.cpSync(target,backup,{recursive:true,errorOnExist:true,force:false});
    fs.rmSync(target,{recursive:true});
    return {removed:name,backup};
  }
  replace(name,oldText,newText) {
    if(typeof oldText!=='string'||!oldText||typeof newText!=='string') throw Error('old_text and new_text required.');
    if(oldText===newText) throw Error('new_text is identical to old_text; nothing would change. Write the corrected text.');
    const content=this.read(name);
    const count=content.split(oldText).length-1;
    if(count!==1) throw Error(count?'old_text occurs '+count+' times; include more surrounding lines so it is unique, or use write with the full file.':'old_text not found. Read the file again and copy the exact text.');
    return this.write(name,content.replace(oldText,()=>newText));
  }
}
// Small models often emit raw newlines inside strings or wrap JSON in prose/fences.
function parseAction(text) {
  const candidates=[text];
  const fenced=/```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if(fenced)candidates.push(fenced[1]);
  const first=text.indexOf('{'),last=text.lastIndexOf('}');
  if(first>=0&&last>first)candidates.push(text.slice(first,last+1));
  // Generation sometimes stops right before the closing brace.
  if(first>=0)candidates.push(text.slice(first).trimEnd()+'}');
  let error;
  for(const candidate of candidates)for(const repair of [false,true]) {
    try {
      const value=JSON.parse(repair?escapeControls(candidate):candidate);
      if(value&&typeof value==='object'&&typeof value.action==='string')return value;
      error=Error('JSON object with "action" is required.');
    }catch(e){error=error||e;}
  }
  throw error;
}
function escapeControls(text) {
  let out='',inString=false,escaped=false;
  for(const ch of text) {
    if(inString&&!escaped&&ch<' ')out+={'\n':'\\n','\r':'\\r','\t':'\\t'}[ch]||'\\u'+ch.charCodeAt(0).toString(16).padStart(4,'0');
    else out+=ch;
    if(escaped)escaped=false;
    else if(ch==='\\'&&inString)escaped=true;
    else if(ch==='"')inString=!inString;
  }
  return out;
}
// Commands are auto-approved inside the workspace; anything that looks like it reaches outside asks the user.
// This is a heuristic, not a sandbox: PowerShell can always be written to escape a text check.
const RISKY=[
  [/(^|[\s'"`(=,;|])\.\.([\\/]|$|[\s'"`;|)])/,'parent folder (..)'],
  [/\\\\[^\\\s]/,'network path'],
  [/(^|[\s'"`(=,;|])~([\\/]|$|[\s'"`;|)])|\$home\b|\$env:|\benv:|\[environment\]/i,'home folder or environment'],
  [/\bhk(lm|cu|cr|u|cc):|\bregistry::|\breg(\.exe)?\s+(add|delete|import|copy)/i,'registry'],
  [/\b(invoke-webrequest|iwr|invoke-restmethod|irm|start-bitstransfer|curl|wget|net\.webclient|net\.http|ssh|scp|ftp|send-mailmessage|new-pssession|enter-pssession|invoke-command)\b|\bgit\s+(push|clone|fetch|pull)\b|\b(npm|pip|winget|choco|scoop|dotnet\s+tool|install-module|install-package)\b/i,'network or install'],
  [/-verb\s+runas|\bset-executionpolicy\b|\b(shutdown|restart-computer|stop-computer|format-volume|clear-disk|bcdedit|takeown|icacls|schtasks|sc(\.exe)?\s+(create|delete|config))\b|\b(new|set|remove)-(service|scheduledtask|localuser|itemproperty)\b/i,'system change'],
  [/\b(set-location|push-location|sl|cd|chdir|pushd)\b|\[(system\.)?io\.|\bnew-psdrive\b|\bsubst\b/i,'changes folder or uses .NET file APIs'],
];
function commandRisk(command, root) {
  for(const [pattern,reason] of RISKY)if(pattern.test(command))return reason;
  const inside=p=>{const full=path.resolve(p).toLowerCase(),base=path.resolve(root).toLowerCase();return full===base||full.startsWith(base+path.sep);};
  for(const m of command.matchAll(/(?:^|[^A-Za-z0-9_])([A-Za-z]:[\\/][^'"`;|<>\r\n]*|[A-Za-z]:(?=[\s'"`;|]|$))/g)) {
    // Trailing words after a path with spaces are trimmed until a prefix stays inside the workspace.
    let p=m[1].trim(),ok=inside(p);
    while(!ok&&/\s/.test(p)){p=p.replace(/\s+\S*$/,'');ok=inside(p);}
    if(!ok)return 'path outside the project: '+m[1].trim().split(/\s/)[0];
  }
  return null;
}
function run(command, cwd, timeout=120000, extraPath=[]) {
  return new Promise(resolve=>{
    const env={...process.env};
    const key=Object.keys(env).find(k=>k.toLowerCase()==='path')||'Path';
    env[key]=[...extraPath,env[key]||''].join(path.delimiter);
    const child=cp.spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',
      '[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false); $ErrorActionPreference="Stop"; '+command],
      {cwd,env,windowsHide:true});
    let timedOut=false;const chunks=[];
    const append=b=>chunks.push(b);
    child.stdout.on('data',append); child.stderr.on('data',append);
    // PowerShell parser errors are printed before OutputEncoding is set, in the ANSI code page (Shift-JIS).
    const decode=()=>{
      const b=Buffer.concat(chunks);
      let text;
      try{text=new TextDecoder('utf-8',{fatal:true}).decode(b);}catch{text=new TextDecoder('shift_jis').decode(b);}
      return text.slice(-16000);
    };
    const timer=setTimeout(()=>{timedOut=true; cp.spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true});},timeout);
    child.on('error',e=>{clearTimeout(timer);resolve({exitCode:-1,output:e.message});});
    child.on('close',code=>{clearTimeout(timer);resolve({exitCode:code,timedOut,output:decode()});});
  });
}
function detectEditors() {
  const env=process.env;
  const vswhere=path.join(env['ProgramFiles(x86)']||'C:\\Program Files (x86)','Microsoft Visual Studio','Installer','vswhere.exe');
  let vs=[];
  if(fs.existsSync(vswhere)) {
    try {vs=JSON.parse(cp.execFileSync(vswhere,['-version','[17.0,18.0)','-products','*','-format','json','-utf8'],{encoding:'utf8',windowsHide:true}));} catch {}
  }
  const editors={};
  const add=(key,p)=>{if(p&&fs.existsSync(p))editors[key]=p;};
  const ide=vs.find(x=>x.productId!=='Microsoft.VisualStudio.Product.BuildTools');
  if(ide)add('visualstudio',ide.productPath);
  // Prefer an instance with the C++ workload so .vcxproj builds work (Build Tools and IDE may both exist).
  const hasCpp=v=>fs.existsSync(path.join(v.installationPath,'VC','Tools','MSVC'));
  for(const v of [...vs.filter(hasCpp),...vs.filter(v=>!hasCpp(v))])if(!editors.msbuild)add('msbuild',path.join(v.installationPath,'MSBuild','Current','Bin','MSBuild.exe'));
  if(vs.some(hasCpp))editors.cppToolset='v143';
  const dotnet=(env.Path||env.PATH||'').split(path.delimiter).map(d=>path.join(d.replace(/"/g,''),'dotnet.exe'))
    .concat(path.join(env.ProgramFiles||'C:\\Program Files','dotnet','dotnet.exe')).find(p=>{try{return fs.statSync(p).isFile();}catch{return false;}});
  if(dotnet)editors.dotnet=dotnet;
  add('vscode',path.join(env.LOCALAPPDATA||'','Programs','Microsoft VS Code','Code.exe'));
  if(!editors.vscode)add('vscode',path.join(env.ProgramFiles||'C:\\Program Files','Microsoft VS Code','Code.exe'));
  const unityRoot=path.join(env.ProgramFiles||'C:\\Program Files','Unity','Hub','Editor');
  if(fs.existsSync(unityRoot))for(const version of fs.readdirSync(unityRoot).sort().reverse()) {
    if(!editors.unity)add('unity',path.join(unityRoot,version,'Editor','Unity.exe'));
  }
  const epicRoot=path.join(env.ProgramFiles||'C:\\Program Files','Epic Games');
  if(fs.existsSync(epicRoot))for(const version of fs.readdirSync(epicRoot).filter(x=>x.startsWith('UE_')).sort().reverse()) {
    if(!editors.unreal)add('unreal',path.join(epicRoot,version,'Engine','Binaries','Win64','UnrealEditor.exe'));
  }
  // Registry and Epic manifest cover custom installation drives.
  try {
    const script="[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false); "+
      "$r=@('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'); "+
      "@(Get-ItemProperty -Path $r -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match '^Unity [0-9]|Visual Studio Code' } | Select-Object DisplayName,DisplayIcon,InstallLocation) | ConvertTo-Json -Compress";
    const installed=JSON.parse(cp.execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',windowsHide:true,timeout:15000})||'[]');
    const unityVersions=[];
    for(const item of installed) {
      const exe=(item.DisplayIcon||'').replace(/,\s*-?\d+$/,'').replace(/^"|"$/g,'');
      if(/^Unity [0-9]/.test(item.DisplayName)&&fs.existsSync(exe))unityVersions.push({version:item.DisplayName.slice(6),path:exe});
      if(/Visual Studio Code/.test(item.DisplayName)&&!editors.vscode)add('vscode',exe);
    }
    unityVersions.sort((a,b)=>b.version.localeCompare(a.version,undefined,{numeric:true}));
    if(unityVersions.length){editors.unityVersions=unityVersions;editors.unity=unityVersions[0].path;}
  }catch {}
  try {
    const manifest=JSON.parse(fs.readFileSync(path.join(env.ProgramData||'C:\\ProgramData','Epic','UnrealEngineLauncher','LauncherInstalled.dat'),'utf8'));
    const versions=manifest.InstallationList.filter(x=>/^UE_/.test(x.AppName))
      .map(x=>({version:x.AppName.slice(3),path:path.join(x.InstallLocation,'Engine','Binaries','Win64','UnrealEditor.exe')}))
      .filter(x=>fs.existsSync(x.path)).sort((a,b)=>b.version.localeCompare(a.version,undefined,{numeric:true}));
    if(versions.length){editors.unrealVersions=versions;editors.unreal=versions[0].path;}
  }catch {}
  for(const key of ['visualstudio','vscode','unity','unreal','msbuild','dotnet'])
    if(env['BONSAI_'+key.toUpperCase()])add(key,env['BONSAI_'+key.toUpperCase()]);
  return editors;
}
function unityFor(editors, target) {
  if(!fs.statSync(target).isDirectory())throw Error('Unity requires a project directory.');
  const versionFile=path.join(target,'ProjectSettings','ProjectVersion.txt');
  if(fs.existsSync(versionFile)&&!process.env.BONSAI_UNITY) {
    const match=fs.readFileSync(versionFile,'utf8').match(/m_EditorVersion:\s*(\S+)/);
    if(match) {
      const installed=(editors.unityVersions||[]).find(x=>x.version===match[1]);
      if(!installed)throw Error('Unity '+match[1]+' not detected. Set BONSAI_UNITY explicitly.');
      return installed.path;
    }
  }
  if(!editors.unity)throw Error('Unity not found. Set BONSAI_UNITY to Unity.exe.');
  return editors.unity;
}
function unrealFor(editors, target) {
  if(path.extname(target).toLowerCase()!=='.uproject')throw Error('Unreal requires a .uproject file.');
  const project=JSON.parse(fs.readFileSync(target,'utf8').replace(/^\uFEFF/,''));
  if(project.EngineAssociation&&!process.env.BONSAI_UNREAL) {
    const installed=(editors.unrealVersions||[]).find(x=>x.version===project.EngineAssociation);
    if(!installed)throw Error('Project Unreal version not detected. Set BONSAI_UNREAL explicitly.');
    return installed.path;
  }
  if(!editors.unreal)throw Error('Unreal not found. Set BONSAI_UNREAL to UnrealEditor.exe.');
  return editors.unreal;
}
const psQuote=s=>"'"+String(s).replace(/'/g,"''")+"'";
// Returns a PowerShell command that builds the project and exits with the build exit code.
function buildCommand(editors, target, logFile) {
  const ext=path.extname(target).toLowerCase();
  if(['.sln','.slnx','.csproj','.vcxproj','.proj','.vbproj','.fsproj'].includes(ext)) {
    if(!editors.msbuild)throw Error('MSBuild not found. Install Visual Studio 2022 Build Tools or set BONSAI_MSBUILD.');
    return {kind:'msbuild',command:'& '+psQuote(editors.msbuild)+' '+psQuote(target)+' /restore /m /nologo /v:m; exit $LASTEXITCODE'};
  }
  if(ext==='.uproject') {
    const engine=path.resolve(path.dirname(unrealFor(editors,target)),'..','..');
    const script=path.join(engine,'Build','BatchFiles','Build.bat');
    if(!fs.existsSync(script))throw Error('Unreal Build.bat not found: '+script);
    if(!fs.existsSync(path.join(path.dirname(target),'Source')))throw Error('Blueprint-only Unreal project has no C++ code to build.');
    const name=path.basename(target,ext)+'Editor';
    return {kind:'unreal',command:'& '+psQuote(script)+' '+psQuote(name)+' Win64 Development '+psQuote('-Project='+target)+' -WaitMutex -NoHotReloadFromIDE; exit $LASTEXITCODE'};
  }
  if(fs.existsSync(target)&&fs.statSync(target).isDirectory()&&fs.existsSync(path.join(target,'ProjectSettings'))) {
    // Unity is a GUI-subsystem exe; Start-Process -Wait is needed to get its exit code.
    const unity=unityFor(editors,target);
    return {kind:'unity',command:'$p=Start-Process -FilePath '+psQuote(unity)+' -ArgumentList @(\'-batchmode\',\'-nographics\',\'-quit\',\'-projectPath\','+
      psQuote('"'+target+'"')+',\'-logFile\','+psQuote('"'+logFile+'"')+') -Wait -PassThru -WindowStyle Hidden; '+
      'if(Test-Path -LiteralPath '+psQuote(logFile)+'){Get-Content -LiteralPath '+psQuote(logFile)+' -Encoding UTF8 -Tail 300}; exit $p.ExitCode'};
  }
  throw Error('Unsupported build target. Use a .sln/.csproj/.vcxproj/.proj file, a Unity project folder, or a C++ .uproject.');
}
// Compiler errors are what the model needs; full logs stay in the session log.
function summarizeBuild(result, cwd) {
  const lines=String(result.output||'').split(/\r?\n/);
  const errors=[...new Set(lines.filter(l=>/\berror\b\s*[A-Z]{0,4}\d*\s*:|: fatal error|Scripts have compiler errors/i.test(l)).map(l=>l.trim()))];
  const warnings=new Set(lines.filter(l=>/\bwarning\b\s*[A-Z]{0,4}\d+\s*:/i.test(l)).map(l=>l.trim()));
  const succeeded=result.exitCode===0&&!result.timedOut;
  // Show the offending source line so the model does not have to count lines.
  const sourceLines=[];
  for(const error of errors.slice(0,5)) {
    const m=/^(.+?)\((\d+),\d+\)\s*:/.exec(error);
    if(!m||!cwd)continue;
    try {
      const file=path.resolve(cwd,m[1]),lines=fs.readFileSync(file,'utf8').split(/\r?\n/),n=Number(m[2]);
      if(lines[n-1]!==undefined)sourceLines.push({file:path.relative(cwd,file)||file,line:n,text:lines[n-1]});
    }catch {}
  }
  return {succeeded,exitCode:result.exitCode,timedOut:!!result.timedOut,errors:errors.slice(0,30),errorLines:sourceLines.length?sourceLines:undefined,warningCount:warnings.size,
    tail:succeeded||!errors.length?lines.filter(Boolean).slice(-15).join('\n'):undefined};
}
function openEditor(editors, editor, target) {
  if(!['visualstudio','vscode','unity','unreal'].includes(editor)||!editors[editor]) throw Error('Editor not found. Set BONSAI_'+String(editor).toUpperCase()+' to its executable path before launching.');
  let executable=editors[editor];
  if(editor==='unity')executable=unityFor(editors,target);
  if(editor==='unreal')executable=unrealFor(editors,target);
  const args=editor==='unity'?['-projectPath',target]:[target];
  const child=cp.spawn(executable,args,{detached:true,stdio:'ignore',windowsHide:false});
  return new Promise((resolve,reject)=>{child.once('error',reject);child.once('spawn',()=>{child.unref();resolve({opened:editor,path:target});});});
}
// Project files are generated from fixed templates because small models cannot write MSBuild XML reliably.
const DOTNET_TEMPLATES={console:'console',classlib:'classlib',winforms:'winforms',wpf:'wpf'};
const CPP_TEMPLATES={'cpp-console':'Console','cpp-windows':'Windows'};
function execFile(file,args,cwd) {
  return new Promise((resolve,reject)=>cp.execFile(file,args,{cwd,windowsHide:true,timeout:180000,
    env:{...process.env,DOTNET_NOLOGO:'1',DOTNET_CLI_TELEMETRY_OPTOUT:'1',DOTNET_SKIP_FIRST_TIME_EXPERIENCE:'1'}},
    (error,stdout,stderr)=>error?reject(Error((stdout+stderr).trim().slice(-3000)||error.message)):resolve(stdout)));
}
const guid=()=>'{'+require('node:crypto').randomUUID().toUpperCase()+'}';
async function createProject(ws, editors, {template,name,path:folder='.',solution}) {
  if(!DOTNET_TEMPLATES[template]&&!CPP_TEMPLATES[template])
    throw Error('template must be one of: '+[...Object.keys(DOTNET_TEMPLATES),...Object.keys(CPP_TEMPLATES)].join(', '));
  if(DOTNET_TEMPLATES[template]&&!editors.dotnet)
    throw Error('.NET SDK not found. Ask the user to install the ".NET desktop development" workload in Visual Studio Installer (or the .NET SDK), or set BONSAI_DOTNET.');
  if(CPP_TEMPLATES[template]&&!editors.cppToolset)
    throw Error('Visual Studio 2022 C++ tools not found. Ask the user to install the "Desktop development with C++" workload in Visual Studio Installer.');
  if(typeof name!=='string'||!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name))throw Error('name must be an ASCII identifier such as MyApp.');
  let slnFile,projectDir;
  if(solution) {
    slnFile=ws.resolve(solution);
    if(path.extname(slnFile).toLowerCase()!=='.sln'||!fs.existsSync(slnFile))throw Error('solution must be an existing .sln file.');
    if(CPP_TEMPLATES[template])throw Error('Adding a C++ project to an existing solution is not supported; create a new solution.');
    projectDir=path.join(path.dirname(slnFile),name);
  } else {
    // Same layout as Visual Studio: <folder>/<Name>/<Name>.sln and <folder>/<Name>/<Name>/<project>
    const solutionDir=ws.resolve(path.join(folder,name));
    if(fs.existsSync(solutionDir))throw Error('Folder already exists: '+path.relative(ws.root,solutionDir));
    slnFile=path.join(solutionDir,name+'.sln');
    projectDir=path.join(solutionDir,name);
  }
  const rel=p=>path.relative(ws.root,p);
  ws.resolve(rel(projectDir));
  if(fs.existsSync(projectDir))throw Error('Folder already exists: '+rel(projectDir));
  let projectFile,output;
  if(DOTNET_TEMPLATES[template]) {
    await execFile(editors.dotnet,['new',DOTNET_TEMPLATES[template],'-n',name,'-o',projectDir,'--no-restore'],ws.root);
    if(!solution)await execFile(editors.dotnet,['new','sln','-n',name,'-o',path.dirname(slnFile)],ws.root);
    projectFile=path.join(projectDir,name+'.csproj');
    await execFile(editors.dotnet,['sln',slnFile,'add',projectFile],ws.root);
    const framework=/<TargetFramework>([^<]+)</.exec(fs.readFileSync(projectFile,'utf8'));
    if(template!=='classlib'&&framework)output=rel(path.join(projectDir,'bin','Debug',framework[1],name+'.exe'));
  } else {
    const id=guid(),files=cppProject(name,id,CPP_TEMPLATES[template],editors.cppToolset);
    for(const [file,content] of Object.entries(files))ws.write(rel(path.join(projectDir,file)),content);
    ws.write(rel(slnFile),cppSolution(name,id));
    projectFile=path.join(projectDir,name+'.vcxproj');
    output=rel(path.join(projectDir,'bin','x64','Debug',name+'.exe'));
  }
  const files=[];
  const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){if(['bin','obj'].includes(e.name))continue;const p=path.join(d,e.name);e.isDirectory()?walk(p):files.push(rel(p));}};
  walk(projectDir);
  return {solution:rel(slnFile),project:rel(projectFile),files,debugExecutable:output,
    next:'Edit the source files, then use build with path '+rel(slnFile)+'. Do not edit project/solution XML by hand.'};
}
function cppProject(name,id,kind,toolset) {
  const console=kind==='Console';
  const config=(c,debug)=>`  <PropertyGroup Condition="'$(Configuration)|$(Platform)'=='${c}|x64'" Label="Configuration">
    <ConfigurationType>Application</ConfigurationType>
    <UseDebugLibraries>${debug}</UseDebugLibraries>
    <PlatformToolset>${toolset}</PlatformToolset>${debug?'':'\n    <WholeProgramOptimization>true</WholeProgramOptimization>'}
    <CharacterSet>Unicode</CharacterSet>
  </PropertyGroup>
`;
  const definitions=(c,debug)=>`  <ItemDefinitionGroup Condition="'$(Configuration)|$(Platform)'=='${c}|x64'">
    <ClCompile>
      <WarningLevel>Level3</WarningLevel>${debug?'':'\n      <FunctionLevelLinking>true</FunctionLevelLinking>\n      <IntrinsicFunctions>true</IntrinsicFunctions>'}
      <SDLCheck>true</SDLCheck>
      <PreprocessorDefinitions>${debug?'_DEBUG':'NDEBUG'};${console?'_CONSOLE':'_WINDOWS'};%(PreprocessorDefinitions)</PreprocessorDefinitions>
      <ConformanceMode>true</ConformanceMode>
      <LanguageStandard>stdcpp20</LanguageStandard>
      <AdditionalOptions>/utf-8 %(AdditionalOptions)</AdditionalOptions>
    </ClCompile>
    <Link>
      <SubSystem>${console?'Console':'Windows'}</SubSystem>${debug?'':'\n      <EnableCOMDATFolding>true</EnableCOMDATFolding>\n      <OptimizeReferences>true</OptimizeReferences>'}
      <GenerateDebugInformation>true</GenerateDebugInformation>
    </Link>
  </ItemDefinitionGroup>
`;
  const vcxproj=`<?xml version="1.0" encoding="utf-8"?>
<Project DefaultTargets="Build" xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <ItemGroup Label="ProjectConfigurations">
    <ProjectConfiguration Include="Debug|x64">
      <Configuration>Debug</Configuration>
      <Platform>x64</Platform>
    </ProjectConfiguration>
    <ProjectConfiguration Include="Release|x64">
      <Configuration>Release</Configuration>
      <Platform>x64</Platform>
    </ProjectConfiguration>
  </ItemGroup>
  <PropertyGroup Label="Globals">
    <VCProjectVersion>17.0</VCProjectVersion>
    <Keyword>Win32Proj</Keyword>
    <ProjectGuid>${id}</ProjectGuid>
    <RootNamespace>${name}</RootNamespace>
    <WindowsTargetPlatformVersion>10.0</WindowsTargetPlatformVersion>
  </PropertyGroup>
  <Import Project="$(VCTargetsPath)\\Microsoft.Cpp.Default.props" />
${config('Debug',true)}${config('Release',false)}  <Import Project="$(VCTargetsPath)\\Microsoft.Cpp.props" />
  <ImportGroup Label="PropertySheets">
    <Import Project="$(UserRootDir)\\Microsoft.Cpp.$(Platform).user.props" Condition="exists('$(UserRootDir)\\Microsoft.Cpp.$(Platform).user.props')" Label="LocalAppDataPlatform" />
  </ImportGroup>
  <PropertyGroup>
    <OutDir>$(ProjectDir)bin\\$(Platform)\\$(Configuration)\\</OutDir>
    <IntDir>$(ProjectDir)obj\\$(Platform)\\$(Configuration)\\</IntDir>
  </PropertyGroup>
${definitions('Debug',true)}${definitions('Release',false)}  <ItemGroup>
    <ClCompile Include="main.cpp" />
  </ItemGroup>
  <Import Project="$(VCTargetsPath)\\Microsoft.Cpp.targets" />
</Project>
`;
  const filters=`<?xml version="1.0" encoding="utf-8"?>
<Project ToolsVersion="4.0" xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <ItemGroup>
    <Filter Include="Source Files">
      <UniqueIdentifier>${guid()}</UniqueIdentifier>
      <Extensions>cpp;c;cc;cxx;c++;cppm;ixx;def;odl;idl;hpj;bat;asm;asmx</Extensions>
    </Filter>
    <Filter Include="Header Files">
      <UniqueIdentifier>${guid()}</UniqueIdentifier>
      <Extensions>h;hh;hpp;hxx;h++;hm;inl;inc;ipp;xsd</Extensions>
    </Filter>
  </ItemGroup>
  <ItemGroup>
    <ClCompile Include="main.cpp">
      <Filter>Source Files</Filter>
    </ClCompile>
  </ItemGroup>
</Project>
`;
  const main=console?`#include <iostream>

int main()
{
    std::cout << "Hello, World!\\n";
    return 0;
}
`:`#include <windows.h>

LRESULT CALLBACK WindowProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    switch (message)
    {
    case WM_PAINT:
    {
        PAINTSTRUCT ps;
        HDC hdc = BeginPaint(hwnd, &ps);
        TextOutW(hdc, 20, 20, L"Hello, World!", 13);
        EndPaint(hwnd, &ps);
        return 0;
    }
    case WM_DESTROY:
        PostQuitMessage(0);
        return 0;
    }
    return DefWindowProcW(hwnd, message, wParam, lParam);
}

int WINAPI wWinMain(HINSTANCE hInstance, HINSTANCE, PWSTR, int nCmdShow)
{
    WNDCLASSW wc{};
    wc.lpfnWndProc = WindowProc;
    wc.hInstance = hInstance;
    wc.hCursor = LoadCursor(nullptr, IDC_ARROW);
    wc.hbrBackground = reinterpret_cast<HBRUSH>(COLOR_WINDOW + 1);
    wc.lpszClassName = L"${name}Window";
    RegisterClassW(&wc);

    HWND hwnd = CreateWindowExW(0, wc.lpszClassName, L"${name}", WS_OVERLAPPEDWINDOW,
        CW_USEDEFAULT, CW_USEDEFAULT, 800, 600, nullptr, nullptr, hInstance, nullptr);
    if (!hwnd) return 0;
    ShowWindow(hwnd, nCmdShow);

    MSG msg;
    while (GetMessageW(&msg, nullptr, 0, 0) > 0)
    {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
    return static_cast<int>(msg.wParam);
}
`;
  return {[name+'.vcxproj']:vcxproj,[name+'.vcxproj.filters']:filters,'main.cpp':main};
}
function cppSolution(name,id) {
  const lines=['','Microsoft Visual Studio Solution File, Format Version 12.00','# Visual Studio Version 17','VisualStudioVersion = 17.0.31903.59','MinimumVisualStudioVersion = 10.0.40219.1',
    `Project("{8BC9CEB8-8B4A-11D0-8D11-00A0C91BC942}") = "${name}", "${name}\\${name}.vcxproj", "${id}"`,'EndProject','Global',
    '\tGlobalSection(SolutionConfigurationPlatforms) = preSolution','\t\tDebug|x64 = Debug|x64','\t\tRelease|x64 = Release|x64','\tEndGlobalSection',
    '\tGlobalSection(ProjectConfigurationPlatforms) = postSolution',
    ...['Debug','Release'].flatMap(c=>[`\t\t${id}.${c}|x64.ActiveCfg = ${c}|x64`,`\t\t${id}.${c}|x64.Build.0 = ${c}|x64`]),'\tEndGlobalSection',
    '\tGlobalSection(SolutionProperties) = preSolution','\t\tHideSolutionNode = FALSE','\tEndGlobalSection',
    '\tGlobalSection(ExtensibilityGlobals) = postSolution','\t\tSolutionGuid = '+guid(),'\tEndGlobalSection','EndGlobal',''];
  return '﻿'+lines.join('\r\n');
}
module.exports={Workspace,commandRisk,run,detectEditors,openEditor,parseAction,buildCommand,summarizeBuild,createProject};

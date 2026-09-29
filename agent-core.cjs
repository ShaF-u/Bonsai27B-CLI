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
    fs.writeFileSync(target,content,'utf8');
    return {saved:name,backup};
  }
  mkdir(name) {
    const target=this.resolve(name);
    fs.mkdirSync(target,{recursive:true});
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
  for(const v of vs)if(!editors.msbuild)add('msbuild',path.join(v.installationPath,'MSBuild','Current','Bin','MSBuild.exe'));
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
  for(const key of ['visualstudio','vscode','unity','unreal','msbuild'])
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
module.exports={Workspace,run,detectEditors,openEditor,parseAction,buildCommand,summarizeBuild};

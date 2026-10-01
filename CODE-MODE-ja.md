# Bonsai コード作業モード

04-code.bat をダブルクリックし、作業するプロジェクトフォルダを入力してください。
Node.js 22以上が必要です（通常チャットには不要）。このPCのNode.jsを利用します。

PowerShellでの例:
```powershell
.\04-code.bat -Workspace "G:\Projects\MyGame" -Model bonsai
.\04-code.bat -Workspace "G:\Projects\MyGame" -Model huihui
.\04-code.bat -Workspace "G:\Projects\MyGame" -Model bonsai -Prompt "ファイルを調べて、プレイヤー移動スクリプトを追加して"

```

できること:
- フォルダ作成、ファイル・フォルダのコピー、名前変更・移動、復元用バックアップを残す削除。
- フォルダ一覧・UTF-8ファイルの読み取り、新規作成、全文保存、一意な文字列の置換。
- PowerShellコマンド実行、ビルド出力を読んだ修正。コマンドは実行前にyで許可。
- Visual Studio 2022 / VS Code / Unity / Unreal Engineでプロジェクトを開く。
- ビルド専用の操作（build）。対象に合わせて自動で方法を選び、コンパイルエラーと該当行だけをBonsaiへ返します。
  - .sln / .csproj / .vcxproj / .proj: 検出したMSBuild（/restore /m）
  - Unityプロジェクトフォルダ: プロジェクトと同じバージョンのUnityをバッチモードで起動（エディタで開いたままだと失敗します）
  - C++の.uproject: エンジン付属のBuild.batで「<名前>Editor Win64 Development」をビルド
- ビルドも実行前にyで許可が必要です（-TrustCommandsで省略）。コマンド内では msbuild をそのまま使えます。
- 同じ操作を変化なしで繰り返した場合は実行せずに別の方法を促し、4回続くと停止して指示を待ちます。

Visual Studio 2022のプロジェクト作成（new_project）:
- 「VS2022のC++コンソールアプリをFizzBuzzという名前で作って、FizzBuzzを書いてビルドして実行して」
- 「C#のWPFアプリをMyToolという名前で作って」
- 「このslnにCoreという名前のC#クラスライブラリを追加して」
- 作れる種類: C# コンソール / クラスライブラリ / Windowsフォーム / WPF、C++ コンソール / Windowsデスクトップ（ウィンドウ表示）
- Visual Studioの「新しいプロジェクト」と同じ構成（フォルダ\名前\名前.sln と フォルダ\名前\名前\プロジェクト）で作成し、そのままVisual Studioで開けます。
- プロジェクトファイル（.sln/.csproj/.vcxproj）はBonsaiに手書きさせず、ツール側の検証済みテンプレートから作ります。
- C++はx64のDebug/Release、C++20、/utf-8（日本語ソース可）。実行ファイルは 名前\bin\x64\Debug\名前.exe に出力されます。
- C++プロジェクトを既存のslnへ追加する操作は未対応です（新しいslnとして作成します）。

指示例:
- 「Assetsを調べて、矢印キーで移動するC#スクリプトを追加して」
- 「この.slnをビルドして、コンパイルエラーを直して」
- 「UnrealのSourceを調べて、指定したクラスを修正して」
- 「このフォルダをVS Codeで開いて」

エディタ画面のクリック、Unityシーンの配置、BlueprintのGUI編集、デバッガ操作は未対応です。
コードの変更は実ファイルに直接反映します。エディタ内の未保存変更は先に保存してください。
既存ファイルの上書き前バックアップと操作履歴は、このCLIの logs/agent-* に保存します。
新規作成ファイルには上書き前バックアップはありません。履歴には指示と読んだコードも含まれます。
/exitで終了、/clearで会話リセット。-Prompt指定は1回の作業で終了します。
1指示につき最大24操作。-MaxStepsで変更できます。
長い会話でコンテキスト上限になった場合は/clearを使い、次の作業を具体的に指示してください。
生成が途中で切れた回答は実行しません。小さいファイル・変更に分けて指示してください。

編集ツールは指定フォルダ内に限定し、.gitとリンク経由の操作を拒否します。
PowerShellコマンドはユーザー権限で動き、指定フォルダ外にもアクセスできます。
信頼できるプロジェクトでコマンド確認を省略する場合は -TrustCommands を指定してください。
注意: -TrustCommands ではAIが生成したコマンドを確認なしで実行するため、ファイル削除など作業フォルダ外への変更も起こり得ます。
logs フォルダのサーバーログとバックアップは30日を過ぎると次回起動時に削除されます。
Unity .metaやUnrealのバイナリアセットを直接テキスト編集する用途には使わないでください。

標準の場所で見つからないエディタ、または複数バージョンの選択には環境変数を使います。
```powershell
$env:BONSAI_UNITY = "D:\Unity\2022.3.62f1\Editor\Unity.exe"
$env:BONSAI_UNREAL = "D:\Epic Games\UE_5.5\Engine\Binaries\Win64\UnrealEditor.exe"
$env:BONSAI_VSCODE = "D:\VSCode\Code.exe"
$env:BONSAI_VISUALSTUDIO = "F:\visualstudioIDE\Common7\IDE\devenv.exe"
.\04-code.bat -Workspace "G:\Projects\MyGame"

```

BONSAI_MSBUILDも実行ファイルの指定に利用できます。
Unityは実際のプロジェクトと同じバージョンを指定してください。
サーバーは127.0.0.1の空きポートと一時キーで起動し、コード作業モード終了時に停止します。
GPUメモリ不足の場合は -Context 8192 または -Cpu を指定してください。

## 別PCで使う場合
インストーラー（Setup.exe）またはGitHubの「Code → Download ZIP」にコード作業モードも含まれています。導入後、04-code.batを使えます。
別PCで必要なもの:
- Node.js 22以上（https://nodejs.org/ のLTS版）
- Visual Studio 2022（Community可）またはBuild Tools 2022。Visual Studio Installerで次のワークロードを入れてください。
  - C#を使う: 「.NET デスクトップ開発」（.NET SDKも入ります）
  - C++を使う: 「C++ によるデスクトップ開発」
- Visual Studio・.NET SDK・C++ツールはインストール場所が標準以外でも自動検出します。見つからない場合、Bonsaiは不足しているものを報告して止まります。
- .NET SDKの場所は BONSAI_DOTNET で指定することもできます。

参照:
- https://github.com/ggml-org/llama.cpp/blob/master/examples/json_schema_pydantic_example.py
- https://github.com/microsoft/vswhere/wiki/Find-MSBuild

Unityのレジストリ、Epic Launcherのインストール情報も参照します。
既存Unity/Unrealプロジェクトを開く際はプロジェクトのバージョンに一致するエディタを選びます。
一致しない場合は自動変換せず停止します。環境変数で明示指定した場合はその指定を優先します。

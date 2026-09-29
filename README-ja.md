# Bonsai 27B CLI セット

## 初回（別のPCでも同じ手順）
1. ZIPを展開し、Bonsai27B-CLI フォルダをデスクトップなどに置く。
2. 00-install.bat をダブルクリック。完了するまで待つ。
3. 01-chat.bat をダブルクリック。質問を入力して Enter。
4. 終了は /exit。生成中の中断は Ctrl+C。

Windows 10/11 x64用。Windows ARM / macOS / Linux用ではありません。
Python・Git・CUDA Toolkitの事前インストールやAPIキーは不要です。
Visual C++実行ライブラリがない、または古いPCではMicrosoft署名を確認して自動導入します。その際はWindowsの管理者承認が必要になる場合があります。
初回はインターネットと約8GB以上のディスク空きが必要です。
モデル本体約3.8GB。失敗したダウンロードは再実行で再開できます。
SHA256でモデルと配布ZIPを検証し、実行環境の版を固定しています。
メモリ16GB以上を目安にしてください。CPU実行はGPUより遅くなります。

## ファイル
- 00-install.bat: 必要ファイルの導入・再確認。
- 01-chat.bat: GPUを自動判定してターミナル内で会話。
- 02-chat-cpu.bat: CPUを指定して会話。GPUメモリ不足時などに使用。
- 03-test.bat: 日本語の質問と計算による動作確認。
- install.ps1 / chat.ps1 / common.ps1: バッチが呼び出す本体。まとめてコピーしてください。

NVIDIAドライバーがCUDA 12.4以上に対応し、先頭GPUのVRAMが約6GB以上ならCUDAを選びます。
それ以外（AMD/Intelを含む）はCPUを使用します。このセットでAMD/IntelのGPU加速は設定しません。
CPUランタイムは常に導入します。別PCへフォルダごと移した場合も最初に00-install.batを実行してください。
既存モデルはハッシュ確認後に再利用します。初回導入後の通常の会話はネット接続不要です。

## CLIからの使用例（PowerShell、このフォルダで実行）
.\01-chat.bat
.\01-chat.bat -NoThinking
.\01-chat.bat -Prompt "日本語で自己紹介してください" -NoThinking
.\01-chat.bat -PromptFile "C:\path\question.txt" -MaxTokens 2048
.\01-chat.bat -Context 8192
.\02-chat-cpu.bat -NoThinking

-Prompt / -PromptFile は1回回答して終了。ファイルはUTF-8で保存してください。
省略時は複数ターンの対話。会話履歴は終了すると失われ、自動保存しません。
通常は思考あり。-NoThinking で短い応答向けに思考を無効化できます。
既定コンテキストはVRAM約11GB以上なら32768、それ以外は8192。
生成上限は4096トークンで、-MaxTokensで変更できます。

GPUメモリ不足時は、既存のBonsaiブラウザ版など別のAIを停止するか、CPU版を使ってください。
このCLIはブラウザや常駐サーバーを起動しません。終了すればモデルを解放します。
画像入力はこのセットの対象外（テキストCLI専用）です。

## 別PCへ渡すもの
Bonsai27B-CLI-installer.zip はスクリプトと説明書だけの小さい配布セットです。
モデルを含めて持ち運ぶ場合は、インストール済みのこのフォルダ全体をコピーできます。
元の Desktop\bat\Bonsai-demo への依存はありません。

## 配布元・固定バージョン
モデル: https://huggingface.co/prism-ml/Bonsai-27B-gguf
モデルrevision: f10afb355f104535e3e3e98cf7ab7795c72bd292
実行環境: https://github.com/PrismML-Eng/llama.cpp/releases/tag/prism-b10743-adfffbe
モデルのライセンス: Apache-2.0（配布元参照）。実行環境のライセンスは配布元を参照。

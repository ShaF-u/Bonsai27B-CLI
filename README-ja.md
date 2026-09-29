# Bonsai 27B CLI セット

## 初回（別のPCでも同じ手順）
1. ZIPを展開し、Bonsai27B-CLI フォルダをデスクトップなどに置く。
2. 00-install.bat をダブルクリック。完了するまで待つ。
3. 01-chat.bat をダブルクリック。質問を入力して Enter。
4. 終了は /exit。生成中の中断は Ctrl+C。

Windows 10/11 x64用。Windows ARM / macOS / Linux用ではありません。
Python・Git・CUDA Toolkitの事前インストールやAPIキーは不要です。
Visual C++実行ライブラリがない、または古いPCではMicrosoft署名を確認して自動導入します。その際はWindowsの管理者承認が必要になる場合があります。
初回はインターネット接続が必要です。ディスク空きは選ぶモデルに応じて8～16GB以上が目安です。
モデル本体はBonsai約3.8GB、Huihui約7.7GBです。失敗したダウンロードは再実行で再開できます。
SHA256でモデルと配布ZIPを検証し、実行環境の版を固定しています。
メモリ16GB以上を目安にしてください。CPU実行はGPUより遅くなります。

## ファイル
- 00-install.bat: 必要ファイルの導入・再確認。
- 01-chat.bat: GPUを自動判定してターミナル内で会話。
- 02-chat-cpu.bat: CPUを指定して会話。GPUメモリ不足時などに使用。
- 03-test.bat: 日本語の質問と計算による動作確認。
- 04-code.bat: コード作業モード。Visual Studio 2022のプロジェクト作成、コードの書き込み、ビルドを日本語で指示できます（詳細は CODE-MODE-ja.md）。
- install.ps1 / chat.ps1 / common.ps1 / agent.ps1 / agent.cjs / agent-core.cjs: バッチが呼び出す本体。まとめてコピーしてください。

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
Bonsaiの既定コンテキストはVRAM約11GB以上なら32768、それ以外は8192。Huihuiは8192。
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

## モデルの選択

00-install.batを起動すると次の選択画面が出ます。

| 番号 / CLI指定 | モデル | 特徴 | モデル容量 |
|---|---|---|---|
| 1 / bonsai | Bonsai 27B（従来版） | Qwen3.6系、1-bit Q1_0。軽量・高速重視 | 約3.8GB |
| 2 / huihui | Huihui Qwen3.8 27B（拒否低減版） | Bonsai 2系、Ternary PQ2_0。拒否を減らす加工あり。品質向上を保証するものではありません | 約7.7GB |
| 3 / both | 両方 | 起動時に切り替えて利用 | 合計約11.5GB |

0はキャンセルです。未導入・導入済みも表示されます。
01-chat.bat / 02-chat-cpu.bat / 03-test.batも、両方導入済みならモデルを選択できます。
1種類だけ導入済みの場合は、そのモデル名を表示して起動します。
既存のBonsaiモデルはそのまま使えます。別モデルの導入で削除・上書きしません。

メニューを省略する場合:
```powershell
.\00-install.bat -Model bonsai
.\00-install.bat -Model huihui
.\00-install.bat -Model both
.\01-chat.bat -Model bonsai -NoThinking
.\01-chat.bat -Model huihui -NoThinking
.\03-test.bat -Model huihui
```

Huihuiは余裕を見て既定コンテキスト8192、GPU自動選択はVRAM約10GB以上にしています。
RTX 3060 12GBもこの設定の対象ですが、3060実機での検証はしていません。
モデルと作業用メモリの両方が必要なため、他のGPUアプリの使用量によってはCPU版を使ってください。
ディスク空き目安はBonsaiのみ8GB以上、Huihuiのみ12GB以上、両方16GB以上です。

Huihui配布元: https://huggingface.co/huihui-ai/Huihui-Qwen3.8-27B-abliterated-GGUF
固定revision: 3f101cd22b7999228bbd5d79a33975414eb9758b
Huihuiも配布元のSHA256で確認し、このセットのPrismML実行環境で起動します。

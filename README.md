# Bonsai 27B CLI for Windows

Bonsai 27B（1-bit / Q1_0）をWindowsのターミナルで実行するためのインストーラーと起動バッチです。

## はじめ方

1. このリポジトリの `Bonsai27B-CLI-installer.zip` をダウンロードして展開します（GitHubの「Code → Download ZIP」でも可）。
2. `00-install.bat` を実行します。
3. `01-chat.bat` を実行し、質問を入力して Enter を押します。
4. `/exit` で終了します。

Windows 10/11 x64用。初回はインターネット接続と約8GB以上のディスク空きが必要です。
モデルは公式配布元からダウンロードします。Python・Git・APIキーの事前準備は不要です。
Visual C++ランタイムが不足している場合はMicrosoftのインストーラーを起動するため、管理者承認が必要になる場合があります。

| ファイル | 用途 |
|---|---|
| `00-install.bat` | モデルと実行環境の導入・再確認 |
| `01-chat.bat` | NVIDIA GPUを自動判定して対話。条件を満たさなければCPUを使用 |
| `02-chat-cpu.bat` | CPUを明示して起動 |
| `03-test.bat` | 日本語と計算の動作確認 |

```powershell
.\01-chat.bat -NoThinking
.\01-chat.bat -Prompt "日本語で自己紹介してください" -NoThinking
.\01-chat.bat -PromptFile "question.txt" -MaxTokens 2048
```

詳細は [日本語の説明書](README-ja.md) を参照してください。

## 確認環境

Windows 11 / RTX 5070 12GB / Intel Core Ultra 7 265 / メモリ64GBで、GPU・CPUの日本語回答、複数ターン対話、終了操作を確認しました。別の実機での動作は未検証です。
このセットはテキストCLI専用です。ブラウザや常駐サーバーは起動しません。
モデル・実行バイナリ・ダウンロードキャッシュはGitの管理対象外です。

## 配布元

- [Bonsai 27Bモデル](https://huggingface.co/prism-ml/Bonsai-27B-gguf)
- [PrismML llama.cpp実行環境](https://github.com/PrismML-Eng/llama.cpp/releases/tag/prism-b10743-adfffbe)

モデルと実行環境の配布ZIPは固定バージョンとSHA256で検証します。
本リポジトリは非公式の導入用スクリプト集です。モデル・実行環境のライセンスはそれぞれの配布元を参照してください。

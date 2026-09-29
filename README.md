# Bonsai 27B CLI for Windows

Bonsai 27B（軽量版）とHuihui Qwen3.8 27B（拒否低減版）を選んで導入・起動できるWindows用CLIセットです。

## はじめ方

1. このリポジトリの `Bonsai27B-CLI-installer.zip` をダウンロードして展開します（GitHubの「Code → Download ZIP」でも可）。
2. `00-install.bat` を実行し、1（Bonsai）・2（Huihui）・3（両方）から選びます。
3. `01-chat.bat` を実行し、質問を入力して Enter を押します。
4. `/exit` で終了します。

Windows 10/11 x64用。初回はインターネット接続と、モデルに応じて8～16GB以上のディスク空きが必要です。
モデルは公式配布元からダウンロードします。Python・Git・APIキーの事前準備は不要です。
Visual C++ランタイムが不足している場合はMicrosoftのインストーラーを起動するため、管理者承認が必要になる場合があります。

| ファイル | 用途 |
|---|---|
| `00-install.bat` | モデルと実行環境の導入・再確認 |
| `01-chat.bat` | NVIDIA GPUを自動判定して対話。条件を満たさなければCPUを使用 |
| `02-chat-cpu.bat` | CPUを明示して起動 |
| `03-test.bat` | 日本語と計算の動作確認 |
| `04-code.bat` | コード作業モード（VS2022プロジェクト作成・コード編集・ビルド。`CODE-MODE-ja.md` 参照） |

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

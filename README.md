# P12 Studio

**P12 Pro へ、ブラウザから Bluetooth でラベル印刷。**

コンパイル・インストール・サーバー・外部ライブラリ不要。`index.html` ひとつで使える、日本語対応のラベル作成ツールです。

[最新版をダウンロード](https://github.com/Xenoah/print-on-web_p12-pro/releases/latest) · [HTML を直接ダウンロード](https://github.com/Xenoah/print-on-web_p12-pro/releases/latest/download/index.html)

![P12 Studio — Chrome から P12 Pro へテストラベルを送信した画面](docs/images/p12-studio.png)

## 使い方

1. [Releases](https://github.com/Xenoah/print-on-web_p12-pro/releases/latest) の **Assets → `index.html`** を保存します。
2. デスクトップ版 **Chrome または Edge** で、その HTML ファイルを開きます。
3. P12 Pro の電源を入れ、Windows の Bluetooth 設定でペアリングします。
4. **Bluetooth 接続** を押し、`P12Pro` またはプリンターの送信 COM ポートを選びます。`JL_SPP（COM番号）` と表示される場合があります。
5. 文字・画像・ラベルの長さを設定し、プレビューを確認して **印刷する** を押します。
6. 印刷が止まったら、本体のカッターで切り取ります。

COM 番号は PC ごとに異なります。Print Master など、同じプリンターに接続するアプリは閉じてください。ブラウザの接続許可は、OS でのペアリングとは別に必要です。

## できること

- 日本語・英数字・複数行テキスト。ゴシック／明朝／等幅、太字、配置、文字サイズの調整
- PNG・JPEG・WebP・BMP の読み込みと白黒変換
- 印刷データと同じ白黒プレビュー
- 12 mm 幅・203 dpi の連続テープに、15〜200 mm のラベルを作成
- 自動縮小、余白、囲み枠、白黒反転、180° 回転
- 1〜20 枚の印刷、現在の 1 枚を送り終えてから残りを停止
- PNG 保存、画像を含むデザインの JSON 保存・読み込み
- 文字と設定のブラウザ内自動保存
- Web Serial による Bluetooth 接続、BLE 対応機向けの接続オプション
- 印刷を伴わない通信確認、通信ログの保存

## 動作確認

2026-10-21 に、Windows の Chrome から P12 Pro へ **COM13** 経由で接続し、次のラベルを実機に出力しました。

```text
P12 テスト
ABC 123
```

- 30 × 12 mm、1 枚、240 × 96 dots
- 初期化、2,880 bytes の画像データ、紙送りの送信を確認
- 使用者による実物の確認で、文字が正常に印刷されたことを確認
- JavaScript の警告・エラーなし

**実機確認済みの経路は Windows / Chrome / Bluetooth Serial です。** Edge、BLE、その他 OS・機種は実機未検証です。Firefox・Safari・iPhone/iPad からの直接印刷は対象外です。画面の自動検証は localhost 上で実施しました。

## 注意点・トラブルシューティング

- 指定したラベルの長さに加えて、切り出しのための紙送りが入ります。
- 「送信完了」は通信の完了を示します。テープ切れなどを含む実機の印刷完了までは保証しません。
- 途中で通信が切れた場合は、自動再送しません。プリンターの電源を入れ直してから再接続してください。
- 接続画面が出ない場合は、このタブを前面に出してから接続ボタンを押してください。
- ポートを開けない場合は、ほかの印刷アプリを終了し、送信側の COM ポートを選び直してください。
- 画像は自動保存されません。画像も残す場合は「デザイン保存」を使ってください。
- 文字の見た目は、利用端末にインストールされているフォントに依存します。

## データの扱い

ラベルの編集・画像処理はブラウザ内で行います。CDN、解析サービス、外部 API への送信はありません。文字と設定は `localStorage` に保存し、印刷データは選択したプリンターへ送ります。

通信ログには機器の製造番号などが含まれる場合があります。ログを公開するときは内容を確認してください。

## 開発・テスト

編集対象は `index.html` です。HTML・CSS・JavaScript をすべて同ファイルに含めています。

通信処理の回帰テストは、Node.js の標準機能のみで実行できます。**通常の利用に Node.js は不要です。**

```sh
node tests/protocol.test.cjs
```

14 項目で、ラスターの回転・ビット配置、ヘッダー、応答待ち、接続の後片付け、複数枚印刷、停止、通信エラー、空ラベル、接続確認中の操作競合を検証します。このテストから実機に印刷は行いません。

```text
index.html                 実行に必要な唯一のファイル
docs/images/p12-studio.png  実機テスト後の画面
tests/protocol.test.cjs     通信処理の回帰テスト
```

## 通信仕様の参考

- [PepperPhil/phomemo_p12](https://github.com/PepperPhil/phomemo_p12)
- [transcriptionstream/phomymo](https://github.com/transcriptionstream/phomymo)
- [Chrome: Serial over Bluetooth on the web](https://developer.chrome.com/blog/serial-over-bluetooth/)

メーカー公式のアプリではありません。P12 Pro 用の公開されている通信実装を参考にしています。

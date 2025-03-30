// src/SheetManager.js - Google Sheets 操作関連

const SheetManager = {

    // ★★★ ご自身のシートの列構成に合わせてインデックス（0始まり）を修正してください ★★★
    COLUMN_MAP: {
        CARD_ID: 0,         // A列: カードID
        RARITY: 1,          // B列: レアリティ (N, R, SR, SSR)
        CARD_TYPE: 2,       // C列: カードタイプ (サポート, コスチューム など)
        CARD_NAME: 3,       // D列: カード名
        CHARACTER_NAME: 4,  // E列: キャラクター名
        IMAGE_FILE_ID: 5,   // F列: DriveのファイルID
        FILE_NAME: 6,       // G列: アップロードされたファイル名
        TIMESTAMP: 7        // H列: 登録日時
        // 必要に応じて他の列も追加
    },
    // --- 設定値ここまで ---

    /**
     * スプレッドシートとシートオブジェクトを取得
     * @private
     * @return {GoogleAppsScript.Spreadsheet.Sheet} シートオブジェクト
     * @throws {Error} スプレッドシートやシートにアクセスできない場合
     */
    /**
     * スプレッドシートとシートオブジェクトを取得 (ヘルパー関数を使用)
     * @private
     */
    getSheet_: function () {
        try {
            const spreadsheetId = getSpreadsheetId_(); // ★ ヘルパー関数使用
            const sheetName = getSheetName_();       // ★ ヘルパー関数使用
            const ss = SpreadsheetApp.openById(spreadsheetId);
            const sheet = ss.getSheetByName(sheetName);
            if (!sheet) { throw new Error(`シート "${sheetName}" が見つかりません`); }
            return sheet;
        } catch (e) {
            Logger.log(`Error accessing Spreadsheet: ${e}`);
            throw new Error(`スプレッドシート/シートにアクセスできません: ${e.message}`);
        }
    },

    /**
     * 指定されたカードIDがシートに存在するか検索する
     * @private
     * @param {string} cardId 検索するカードID
     * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet シートオブジェクト
     * @return {object|null} 存在すれば { row: 行番号 }, なければ null
     */
    findCardById_: function (cardId, sheet) {
        const targetSheet = sheet || this.getSheet_(); // 引数がなければ取得
        const lastRow = targetSheet.getLastRow();
        if (lastRow < 2) { // ヘッダー行のみの場合は存在しない
            return null;
        }
        // CardID列 (A列想定) の値を取得
        const idColumnIndex = this.COLUMN_MAP.CARD_ID + 1; // 1始まりの列番号
        const idColumnValues = targetSheet.getRange(
            2, // 開始行 (ヘッダー除く)
            idColumnIndex, // 開始列 (CardID列)
            lastRow - 1, // 取得行数
            1 // 取得列数
        ).getValues();

        // cardIdと一致するものを探す
        for (let i = 0; i < idColumnValues.length; i++) {
            // 完全一致で比較 (型も考慮するなら ===)
            if (String(idColumnValues[i][0]) === String(cardId)) {
                const rowNumber = i + 2; // シート上の実際の行番号 (+2 はヘッダー行と0始まりindexのため)
                Logger.log(`Card ID ${cardId} found at row ${rowNumber}.`);
                return { row: rowNumber }; // 行番号を返す
            }
        }
        Logger.log(`Card ID ${cardId} not found.`);
        return null; // 見つからなかった
    },

    /**
     * 新しいカード情報をシートに追記する
     * @private
     * @param {object} cardInfo Geminiから取得したカード情報 { rarity, cardType, cardId, cardName, characterName }
     * @param {string} fileId Google DriveのファイルID
     * @param {string} fileName 元のファイル名
     * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet シートオブジェクト
     * @return {boolean} 成功すれば true
     * @throws {Error} 書き込み中にエラーが発生した場合
     */
    registerNewCard_: function (cardInfo, fileId, fileName, sheet) {
        const targetSheet = sheet || this.getSheet_();
        const timestamp = new Date();

        // シートの列構成に合わせて書き込むデータ配列を作成
        // COLUMN_MAP を使って正しい列にデータが入るようにする
        const newRowData = [];
        newRowData[this.COLUMN_MAP.CARD_ID] = cardInfo.cardId;
        newRowData[this.COLUMN_MAP.RARITY] = cardInfo.rarity;
        newRowData[this.COLUMN_MAP.CARD_TYPE] = cardInfo.cardType;
        newRowData[this.COLUMN_MAP.CARD_NAME] = cardInfo.cardName;
        newRowData[this.COLUMN_MAP.CHARACTER_NAME] = cardInfo.characterName;
        newRowData[this.COLUMN_MAP.IMAGE_FILE_ID] = fileId;
        newRowData[this.COLUMN_MAP.FILE_NAME] = fileName;
        newRowData[this.COLUMN_MAP.TIMESTAMP] = timestamp;
        // 他の列があれば、対応するデータを追加 or 空文字/nullで埋める

        // 配列の長さをシートの列数に合わせる (安全のため)
        const maxCols = targetSheet.getMaxColumns();
        const fullRow = Array(maxCols).fill(''); // 空文字で初期化
        for (let i = 0; i < newRowData.length; i++) {
            if (i < maxCols && newRowData[i] !== undefined) {
                fullRow[i] = newRowData[i];
            }
        }

        try {
            targetSheet.appendRow(fullRow);
            SpreadsheetApp.flush(); // 変更を即時反映（必要に応じて）
            Logger.log(`New card registered to sheet: ID=${cardInfo.cardId}, FileID=${fileId}`);
            return true;
        } catch (e) {
            Logger.log(`Error appending row to sheet: ${e}`);
            throw new Error(`シートへの書き込み中にエラーが発生しました: ${e.message}`);
        }
    },

    /**
     * カードの重複をチェックし、なければ登録する (外部から呼び出すメイン関数)
     * @param {object} cardInfo Geminiから取得したカード情報
     * @param {string} fileId Google DriveのファイルID
     * @param {string} fileName 元のファイル名
     * @return {object} 処理結果 { status: 'success'|'duplicate'|'error', cardId?: string, message: string }
     */
    checkAndRegisterCard_: function (cardInfo, fileId, fileName) {
        try {
            // cardInfo や cardId の存在チェック
            if (!cardInfo || typeof cardInfo !== 'object') {
                throw new Error("内部エラー: カード情報オブジェクトが無効です。");
            }
            if (!cardInfo.cardId) {
                throw new Error("カード情報に必須のカードIDが含まれていません。Geminiの応答を確認してください。");
            }

            const sheet = this.getSheet_(); // シート操作前に一度だけ取得

            // 重複チェック
            const existingCard = this.findCardById_(cardInfo.cardId, sheet);

            if (existingCard) {
                // --- 重複あり ---
                Logger.log(`Duplicate card found: ID=${cardInfo.cardId} at row ${existingCard.row}`);
                return {
                    status: 'duplicate',
                    cardId: cardInfo.cardId,
                    message: `カード (ID: ${cardInfo.cardId}) は既に登録されています。(登録済み行: ${existingCard.row})`
                };
            } else {
                // --- 重複なし -> 登録処理 ---
                const registered = this.registerNewCard_(cardInfo, fileId, fileName, sheet);
                if (registered) {
                    return {
                        status: 'success',
                        cardId: cardInfo.cardId,
                        message: `新しいカード (ID: ${cardInfo.cardId}) を登録しました。`
                        // 必要なら登録したカード情報 cardInfo を含めても良い
                    };
                } else {
                    // registerNewCard_内でエラーが投げられなかった場合 (通常は発生しないはず)
                    Logger.log(`Registration seemed to fail without throwing error for card ID: ${cardInfo.cardId}`);
                    return { status: 'error', message: 'シートへの登録処理に失敗しました（原因不明）。' };
                }
            }
        } catch (e) {
            // getSheet_, findCardById_, registerNewCard_ で発生したエラーをキャッチ
            Logger.log(`Error in checkAndRegisterCard_: ${e}`);
            return { status: 'error', message: `シート処理エラー: ${e.message}` };
        }
    },

    /**
     * 登録されている全てのカード情報をシートから取得する (カードスリーブ表示用)
     * @return {Array<object>} カード情報の配列 (シートの列構成に基づくオブジェクト)
     * @throws {Error} シートからの読み込み中にエラーが発生した場合
     */
    getAllCards_: function () {
        let sheet;
        try {
            sheet = this.getSheet_();
        } catch (e) {
            // getSheet_ でのエラーをそのまま投げる
            throw e;
        }

        const lastRow = sheet.getLastRow();
        // ヘッダー行(1行目)しかない、またはデータがない場合
        if (lastRow < 2) {
            Logger.log("No card data found in the sheet.");
            return []; // 空の配列を返す
        }

        try {
            const dataRange = sheet.getRange(
                2, // 開始行 (ヘッダー除く)
                1, // 開始列 (A列)
                lastRow - 1, // 取得行数
                sheet.getLastColumn() // 最後の列まで取得
            );
            const values = dataRange.getValues();

            // 各行をオブジェクトに変換
            const cards = values.map(row => {
                // シートの列構成に合わせてオブジェクトにマッピング
                // COLUMN_MAP を使って可読性を上げる
                const card = {};
                card.cardId = row[this.COLUMN_MAP.CARD_ID];
                card.rarity = row[this.COLUMN_MAP.RARITY];
                card.cardType = row[this.COLUMN_MAP.CARD_TYPE];
                card.cardName = row[this.COLUMN_MAP.CARD_NAME];
                card.characterName = row[this.COLUMN_MAP.CHARACTER_NAME];
                card.fileId = row[this.COLUMN_MAP.IMAGE_FILE_ID];
                card.fileName = row[this.COLUMN_MAP.FILE_NAME];
                // 日付はDateオブジェクトとして取得されるが、シリアライズのためにISO文字列などに変換してもよい
                card.timestamp = row[this.COLUMN_MAP.TIMESTAMP] instanceof Date
                    ? row[this.COLUMN_MAP.TIMESTAMP].toISOString()
                    : row[this.COLUMN_MAP.TIMESTAMP]; // または適切なエラー処理/デフォルト値
                return card;
            });
            Logger.log(`Retrieved ${cards.length} cards from the sheet.`);
            return cards; // カード情報の配列を返す

        } catch (e) {
            Logger.log(`Error reading data from sheet: ${e}`);
            throw new Error(`シートからのカード情報読み込みエラー: ${e.message}`);
        }
    }

};
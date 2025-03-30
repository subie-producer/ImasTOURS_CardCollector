// コード.gs
function doGet(e) {
    // index.htmlテンプレートを評価してHTMLサービス出力を生成
    return HtmlService.createTemplateFromFile('index')
        .evaluate()
        .setTitle('TOURS Card Collector') // ブラウザタブのタイトル設定
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT); // セキュリティ設定 (通常はDEFAULTでOK)
}

function include(filename) {
    // 指定されたファイル名のHTMLコンテンツを取得
    return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
// src/コード.js (processUploadedImage と getRegisteredCards の修正・追加)

/**
 * フロントエンドから呼び出されるメイン関数。
 * 画像データをDrive保存 -> Gemini情報抽出 -> ★ファイル名変更★ -> Sheet登録/重複チェック を行う。
 * @param {string} base64Data Base64エンコードされた画像データ
 * @param {string} originalFileName ★元のファイル名
 * @return {object} 処理結果
 */
function processUploadedImage(base64Data, originalFileName) {
    // ★ パラメータ名を明確化
    if (!base64Data || !originalFileName) {
        return { status: 'error', message: '画像データまたは元のファイル名が不足しています。' };
    }

    let imageBlob;
    let fileId = null;
    let finalFileName = originalFileName; // ★ 最終的にシートに記録するファイル名 (初期値は元ファイル名)

    try {
        // --- 画像Blob作成 (変更なし) ---
        let mimeType = 'application/octet-stream';
        const extension = originalFileName.split('.').pop().toLowerCase();
        if (['jpg', 'jpeg'].includes(extension)) mimeType = 'image/jpeg';
        else if (extension === 'png') mimeType = 'image/png';
        else if (extension === 'gif') mimeType = 'image/gif';
        imageBlob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, originalFileName);
        // --- ここまで ---


        // 1. Driveに保存 (元ファイル名で一旦保存)
        fileId = DriveManager.saveImageToDrive_(imageBlob, originalFileName);
        Logger.log(`Image saved temporarily. File ID: ${fileId}. Getting Card Info...`);

        // 2. Gemini APIでカード情報を取得
        const cardInfo = GeminiAPI.getCardInfoFromImage_(imageBlob);

        // 3. カード情報取得成功時の処理
        if (cardInfo && cardInfo.cardId) {
            Logger.log(`Successfully retrieved card info for ID: ${cardInfo.cardId}. Renaming file...`);

            // ★★★ ファイル名変更処理を追加 ★★★
            try {
                // 元のファイル拡張子を取得 (例: ".jpg", ".png")
                let extension = '';
                if (originalFileName.includes('.')) {
                    extension = originalFileName.substring(originalFileName.lastIndexOf('.'));
                }
                // 新しいファイル名を生成 (カードID + 拡張子)
                const newFileName = cardInfo.cardId + extension;

                // ★ DriveManager のリネーム関数を呼び出す
                const renamed = DriveManager.renameFile_(fileId, newFileName);
                if (renamed) {
                    finalFileName = newFileName; // ★ リネーム成功したら最終ファイル名を更新
                    Logger.log(`File renamed successfully to: ${finalFileName}`);
                } else {
                    // リネーム失敗時はログを残し、元のファイル名のまま進む
                    Logger.log(`File rename failed for ID: ${fileId}. Proceeding with original name: ${originalFileName}`);
                    finalFileName = originalFileName;
                }
            } catch (renameError) {
                // リネーム処理中に予期せぬエラーが発生した場合
                Logger.log(`Error during file rename: ${renameError}. Proceeding with original name: ${originalFileName}`);
                finalFileName = originalFileName;
            }
            // 4. SheetManager連携 (★最終的なファイル名を渡す)
            const registrationResult = SheetManager.checkAndRegisterCard_(cardInfo, fileId, finalFileName);
            Logger.log(`SheetManager result: ${JSON.stringify(registrationResult)}`);

            // 戻り値に、実際に登録されたファイル名を含めると親切
            return { ...registrationResult, registeredFileName: finalFileName };

        } else {
            // カード情報取得失敗時の処理 (変更なし)
            Logger.log(`Failed to get Card Info for file: ${originalFileName} (ID: ${fileId}).`);
            return { status: 'error', message: 'カード情報の読み取りに失敗しました。ファイル名は変更されませんでした。', fileId: fileId };
        }

    } catch (e) {
        // 全体エラー処理 (変更なし)
        Logger.log(`Error in processUploadedImage: ${e}`);
        return { status: 'error', message: `サーバー処理エラー: ${e.message}` };
    }
}
// レアリティのソート順を定義するマップ (関数の外か、中で定義)
const RARITY_ORDER = { 'N': 1, 'R': 2, 'SR': 3, 'SSR': 4 };

/**
 * 登録されている全てのカード情報をシートから取得し、
 * スリーブ用と拡大表示用の画像URL、共通エラー画像URL、カード総枚数を追加して返す。（ソートはしない）
 * @return {object} { status: 'success'|'error', cards?: Array<object>, cardCount?: number, commonErrorImageUrl?: string, message?: string }
 */
function getRegisteredCards() {
    Logger.log('getRegisteredCards called (Client sort, Prepares Large Thumbnails)');
    try {
        let cards = SheetManager.getAllCards_();
        Logger.log(`Retrieved ${cards.length} basic card data from Sheet.`);

        // --- URL生成 ---
        const scheme = 'ht' + 'tps';
        const placeholderBaseUrl = `${scheme}://via.placeholder.com/`;
        // スリーブ用プレースホルダー
        const sleevePlaceholderUrl = `${placeholderBaseUrl}150x210/eee/ccc?text=`;
        // ★ 拡大表示用プレースホルダー (少し大きく)
        const largePlaceholderUrl = `${placeholderBaseUrl}400x560/eee/ccc?text=`;
        // 共通エラー画像URL
        const commonErrorImageUrl = `${placeholderBaseUrl}300x420/f8d7da/721c24?text=Load%20Error`;

        const cardsWithUrls = cards.map(card => {
            let imageUrl = null;         // スリーブ表示用
            let largeImageUrl = null;    // ★ 拡大表示用
            let thumbnailUrl = null;     // Driveから取得する元URL

            if (card.fileId) {
                try {
                    const fileMetadata = Drive.Files.get(card.fileId, { fields: 'id, name, thumbnailLink' });
                    if (fileMetadata && fileMetadata.thumbnailLink) {
                        thumbnailUrl = fileMetadata.thumbnailLink;
                        // スリーブ用URL (例: =s200)
                        imageUrl = thumbnailUrl.replace(/=s\d+$/, '=s200');
                        // ★ 拡大用URL (例: =s800, サイズは適宜調整。'=s0'で最大サイズも可)
                        largeImageUrl = thumbnailUrl.replace(/=s\d+$/, '=s800');
                    }
                } catch (driveError) { /* ... エラーログ ... */ }
            }

            // URLが取得できなかった場合のプレースホルダーを設定
            if (!imageUrl) imageUrl = `${sleevePlaceholderUrl}${encodeURIComponent(card.cardId || 'No Image')}`;
            if (!largeImageUrl) largeImageUrl = `${largePlaceholderUrl}${encodeURIComponent(card.cardId || 'No Image')}`;

            // 必要なURLを追加して返す
            const { thumbnailUrl: _, errorImageUrl: __, ...restOfCard } = card;
            return { ...restOfCard, imageUrl: imageUrl, largeImageUrl: largeImageUrl }; // ★ largeImageUrl を追加
        });

        Logger.log(`Finished processing image URLs for ${cardsWithUrls.length} cards.`);
        // 戻り値に共通エラーURLも追加
        return {
            status: 'success',
            cards: cardsWithUrls,
            cardCount: cardsWithUrls.length,
            commonErrorImageUrl: commonErrorImageUrl
        };

    } catch (e) {
        Logger.log(`Error in getRegisteredCards: ${e}`);
        return { status: 'error', message: `カードリストの取得エラー: ${e.message}` };
    }
}


/**
 * ★【内部関数化】1枚の画像データを処理する
 * @private
 * @param {object} fileData { imageData: string, fileName: string }
 * @return {object} 処理結果 { status, cardId?, message?, registeredFileName?, originalFileName? }
 */
function _processSingleImage(fileData) {
    const { imageData, fileName: originalFileName } = fileData;
    if (!imageData || !originalFileName) {
        return { status: 'error', message: '内部エラー: データ不足', originalFileName: originalFileName };
    }

    let imageBlob, fileId = null, finalFileName = originalFileName, cardInfo = null;
    let registrationStatus = 'error'; // デフォルトステータス
    let cardId = null; // cardId を try ブロックの外でアクセス可能に
    try {

        let mimeType = 'application/octet-stream';
        const extension = originalFileName.split('.').pop().toLowerCase();
        if (['jpg', 'jpeg'].includes(extension)) mimeType = 'image/jpeg';
        else if (extension === 'png') mimeType = 'image/png';
        else if (extension === 'gif') mimeType = 'image/gif';
        imageBlob = Utilities.newBlob(Utilities.base64Decode(imageData), mimeType, originalFileName);
        fileId = DriveManager.saveImageToDrive_(imageBlob, originalFileName);
        if (!fileId) throw new Error("Drive保存失敗");

        cardInfo = GeminiAPI.getCardInfoFromImage_(imageBlob);
        if (cardInfo && cardInfo.cardId) {

            cardId = cardInfo.cardId; // cardId を取得
            Logger.log(`Card info OK: ID=${cardId}. Checking duplicates...`);
            const extension = originalFileName.includes('.') ? originalFileName.substring(originalFileName.lastIndexOf('.')) : '';

            // 5. ★ シートで重複チェック ★
            const existingCard = SheetManager.findCardById_(cardId); // findCardById_ を直接呼び出す

            let renameSuccess = false;

            if (existingCard) {
                // --- 5a. 重複カードの場合 ---
                registrationStatus = 'duplicate';
                Logger.log(`Duplicate found (Row: ${existingCard.row}). Renaming with timestamp...`);
                // ★ タイムスタンプ付きファイル名を生成
                const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMddHHmmssSSS"); // ミリ秒まで追加して一意性を高める
                finalFileName = `${cardId}_${timestamp}${extension}`;
                // ★ リネーム実行
                renameSuccess = DriveManager.renameFile_(fileId, finalFileName);
                if (!renameSuccess) finalFileName = originalFileName; // 失敗時は元に戻す

                // シートへの登録は行わない

            } else {
                // --- 5b. 新規カードの場合 ---
                Logger.log(`New card. Renaming to CardID...`);
                // ★ カードIDファイル名を生成
                finalFileName = cardId + extension;
                // ★ リネーム実行
                renameSuccess = DriveManager.renameFile_(fileId, finalFileName);
                if (!renameSuccess) finalFileName = originalFileName; // 失敗時は元に戻す

                // ★ シートへの登録実行 ★
                try {
                    // registerNewCard_ を直接呼び出す (finalFileName を渡す)
                    const registered = SheetManager.registerNewCard_(cardInfo, fileId, finalFileName);
                    if (registered) {
                        registrationStatus = 'success'; // 登録成功
                        Logger.log(`Registered new card to sheet. FileName: ${finalFileName}`);
                    } else {
                        registrationStatus = 'error';
                        Logger.log(`Sheet registration failed (no error thrown) for ${finalFileName}`);
                    }
                } catch (sheetError) {
                    registrationStatus = 'error';
                    Logger.log(`Sheet registration failed for ${finalFileName}: ${sheetError}`);
                    // エラーが起きた場合、ファイル名はリネームされたままになる可能性がある
                    // 必要ならここでリネームを元に戻す処理を入れることも検討
                }
            }
            // 6. 結果オブジェクトを返す
            return {
                status: registrationStatus,
                cardId: cardId,
                message: registrationStatus === 'success' ? '新規登録しました。' :
                    registrationStatus === 'duplicate' ? '既に登録されています。' :
                        'シート登録/リネーム中にエラーが発生しました。',
                registeredFileName: finalFileName, // 実際にDriveに設定された(はずの)名前
                originalFileName: originalFileName
            };
        } else {
            // DriveManager.deleteFileById_(fileId); // オプション
            return { status: 'error', message: 'カード情報読取失敗', originalFileName: originalFileName, fileId: fileId };
        }
    } catch (e) {
        // if (fileId) { try { DriveManager.deleteFileById_(fileId); } catch(delErr){} } // オプション
        return { status: 'error', message: `処理エラー: ${e.message}`, originalFileName: originalFileName };
    }
}

/**
 * ★【新設】フロントエンドから呼び出される複数ファイル処理関数
 * @param {Array<object>} filesArray [{ imageData: string, fileName: string }, ...]
 * @return {Array<object>} 各ファイルの処理結果の配列
 */
function processMultipleImages(filesArray) {
    if (!Array.isArray(filesArray)) {
        return [{ status: 'error', message: '内部エラー: 不正なデータ形式です。' }]; // エラーを示す配列を返す
    }
    if (filesArray.length === 0) return []; // 空なら空で返す

    // ★ 最大枚数制限 (サーバー側でも念のため) - フロントと同じ値にする
    const MAX_SERVER_FILES = 12;
    if (filesArray.length > MAX_SERVER_FILES) {
        return [{ status: 'error', message: `サーバーエラー: 一度に処理できるのは ${MAX_SERVER_FILES} 枚までです。` }];
    }

    Logger.log(`Processing ${filesArray.length} images sequentially...`);
    const results = [];
    let startTime, elapsedTime;

    for (const fileData of filesArray) {
        if (!fileData) {
            results.push({ status: 'error', message: '内部エラー: 不正なファイルデータです。', originalFileName: '(不明)' });
            continue;
        }
        startTime = new Date().getTime(); // 開始時間記録
        Logger.log(`Processing file: ${fileData.fileName}`);
        const result = _processSingleImage(fileData); // 内部関数呼び出し
        results.push(result);
        elapsedTime = new Date().getTime() - startTime; // 処理時間
        Logger.log(`Result for ${fileData.fileName}: ${result.status} (${elapsedTime} ms)`);

        // --- レートリミット待機 (今回は不要と判断) ---
        const waitTime = 6000 - elapsedTime; // 6秒に1回にするための残り待機時間
        if (waitTime > 0) {
            Logger.log(`Waiting ${waitTime}ms for rate limit...`);
            Utilities.sleep(waitTime);
        }
        // --- ここまで ---
    }

    Logger.log(`Finished processing ${filesArray.length} images.`);
    return results; // 結果の配列を返す
}
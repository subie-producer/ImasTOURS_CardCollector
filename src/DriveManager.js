// DriveManager.js - Google Drive関連の操作

const DriveManager = {
    /**
     * 画像Blobを指定されたフォルダに保存し、ファイルIDを返す
     * @param {GoogleAppsScript.Base.Blob} imageBlob 保存する画像のBlobオブジェクト
     * @param {string} fileName 保存するファイル名
     * @return {string|null} 保存されたファイルのID、失敗した場合はnull
     */
    saveImageToDrive_: function (imageBlob, fileName) {
        try {
            const folderId = getDriveFolderId_();
            const folder = DriveApp.getFolderById(folderId);

            // 同じ名前のファイルがあった場合の処理（必要に応じて。例：上書きしない）
            const existingFiles = folder.getFilesByName(fileName);
            if (existingFiles.hasNext()) {
                // ここでは単純に上書きせず、エラーとするか、別名をつけるか選択
                // 例: 別名をつける (ファイル名 + タイムスタンプ)
                const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMddHHmmss");
                fileName = `${fileName.split('.').slice(0, -1).join('.')}_${timestamp}.${fileName.split('.').pop()}`;
                Logger.log(`File name collision. Renaming to: ${fileName}`);
            }

            const file = folder.createFile(imageBlob);
            file.setName(fileName); // Blob作成時に名前をつけても、ここで再設定するのが確実
            Logger.log(`File saved successfully. Name: ${fileName}, ID: ${file.getId()}`);
            return file.getId();

        } catch (e) {
            Logger.log(`Error in saveImageToDrive_: ${e}`);
            // エラーメッセージをもう少し具体的にする
            if (e.message.includes("Access denied: DriveApp")) {
                throw new Error("Google Driveへのアクセス権限がありません。スクリプトの承認を確認してください。");
            } else if (e.message.includes("Folder not found")) {
                throw new Error(`指定されたDriveフォルダが見つかりません (ID: ${folderId})。設定を確認してください。`);
            }
            throw new Error(`Google Driveへの保存中にエラーが発生しました: ${e.message}`); // 元のエラーをラップして投げる
        }
    },

    /**
     * ★【新設】指定されたファイルIDのファイル名を変更する
     * @private
     * @param {string} fileId 変更対象のファイルID
     * @param {string} newFileName 新しいファイル名
     * @return {boolean} 成功すれば true, 失敗すれば false
     * @throws {Error} Drive APIのエラーが発生した場合（呼び出し元でcatchする）
     */
    renameFile_: function (fileId, newFileName) {
        if (!fileId || !newFileName) {
            Logger.log("Rename failed: fileId or newFileName is missing.");
            return false; // 引数不足は失敗とする
        }
        try {
            const file = DriveApp.getFileById(fileId);
            file.setName(newFileName); // ★ ファイル名を変更
            Logger.log(`File ${fileId} renamed to ${newFileName}`);
            return true; // 成功
        } catch (e) {
            // エラーログは出すが、エラーは呼び出し元に投げる
            Logger.log(`Error renaming file ${fileId} to ${newFileName}: ${e}`);
            // throw e; // エラーを上に投げて processUploadedImage でキャッチさせる
            return false; // またはここで false を返して失敗を示す
        }
    },
    /**
     * (オプション) ファイルIDを指定してファイルをゴミ箱に移動する
     * @param {string} fileId ゴミ箱に移動するファイルのID
     * @return {boolean} 成功した場合はtrue、失敗した場合はfalse
     */
    deleteFileById_: function (fileId) {
        try {
            DriveApp.getFileById(fileId).setTrashed(true);
            Logger.log(`File with ID ${fileId} moved to trash.`);
            return true;
        } catch (e) {
            Logger.log(`Error deleting file with ID ${fileId}: ${e}`);
            return false;
        }
    }
};

// グローバルスコープでアクセス可能にする (HTMLの google.script.run から直接は呼ばないが念のため)
// ※ Managerオブジェクト内の関数を直接呼び出すことはないので、これは通常不要
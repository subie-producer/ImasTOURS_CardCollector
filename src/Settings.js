// src/Settings.gs (修正後)

// --- スクリプトプロパティから設定値を取得するヘルパー関数群 ---

/**
 * スプレッドシートIDをスクリプトプロパティから取得する
 * @private
 * @return {string} スプレッドシートID
 * @throws {Error} プロパティが設定されていない場合
 */
function getSpreadsheetId_() {
    const scriptProperties = PropertiesService.getScriptProperties();
    const spreadsheetId = scriptProperties.getProperty('SPREADSHEET_ID');
    if (!spreadsheetId) {
      // READMEの手順への参照を促すメッセージ
      throw new Error('スプレッドシートID (SPREADSHEET_ID) がスクリプトプロパティに設定されていません。READMEのセットアップ手順を確認してください。');
    }
    return spreadsheetId;
  }
  
  /**
   * カードリストが格納されているシート名を返す (現在は固定値)
   * @private
   * @return {string} シート名
   */
  function getSheetName_() {
      // シート名は固定 'CardList' とする
      // もし変更可能にしたい場合は、上記と同様にプロパティから取得する関数を作成
      return 'CardList';
  }
  
  /**
   * Google Driveの保存先フォルダIDをスクリプトプロパティから取得する
   * @private
   * @return {string} DriveフォルダID
   * @throws {Error} プロパティが設定されていない場合
   */
  function getDriveFolderId_() {
    const scriptProperties = PropertiesService.getScriptProperties();
    const folderId = scriptProperties.getProperty('DRIVE_FOLDER_ID');
    if (!folderId) {
      throw new Error('DriveフォルダID (DRIVE_FOLDER_ID) がスクリプトプロパティに設定されていません。READMEのセットアップ手順を確認してください。');
    }
    return folderId;
  }
  
  /**
   * Gemini APIキーをスクリプトプロパティから取得する
   * @private
   * @return {string} Gemini APIキー
   * @throws {Error} プロパティが設定されていない場合
   */
  function getApiKey_() {
    const scriptProperties = PropertiesService.getScriptProperties();
    const apiKey = scriptProperties.getProperty('GEMINI_API_KEY');
    if (!apiKey) {
      throw new Error('Gemini APIキー (GEMINI_API_KEY) がスクリプトプロパティに設定されていません。READMEのセットアップ手順を確認してください。');
    }
    return apiKey;
  }
  
  // ★ SETTINGS オブジェクトと getGcpProjectId_ は不要のため削除
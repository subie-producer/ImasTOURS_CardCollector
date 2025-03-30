// GeminiAPI.js - Vertex AI Gemini API 関連の操作

const GeminiAPI = {

    /**
     * 画像BlobからGemini APIを使用してカード情報を抽出する
     * @param {GoogleAppsScript.Base.Blob} imageBlob カード画像のBlobオブジェクト
     * @return {object|null} 抽出されたカード情報オブジェクト、またはエラーの場合はnull
     * 例: { rarity: "N", cardType: "サポート", cardId: "IMT-01-069", cardName: "ライブサポート", characterName: "如月千早" }
     */
    getCardInfoFromImage_: function (imageBlob) {
        let apiKey;
        try {
            apiKey = getApiKey_(); // Settings.js 内のヘルパー関数で取得
        } catch (e) {
            Logger.log(`APIキー取得エラー: ${e.message}`);
            // フロントエンドにエラーを返すために例外を再スローするのも手
            throw new Error(`APIキーが設定されていません。管理者に連絡してください。`);
        }

        // モデルIDと言語モデルAPIのエンドポイント (generateContentを使用)
        const model = 'gemini-1.5-flash-latest'; // 最新のFlashモデル推奨
        const generateContentEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        Logger.log(`Using Gemini Model: ${model}`);
        Logger.log(`Calling Endpoint: ${generateContentEndpoint.split('?')[0]}?key=...`); // キーはログに出さない

        try {
            const base64ImageData = Utilities.base64Encode(imageBlob.getBytes());
            const mimeType = imageBlob.getContentType() || 'image/jpeg'; // BlobにContentTypeがなければJPEGと仮定

            // 実験スクリプトを参考にしたリクエストボディ
            const requestBody = {
                "contents": [
                    {
                        "role": "user",
                        "parts": [
                            {
                                "text": "あなたはカードゲームのカード情報分析エキスパートです。提供されたカード画像から指定された情報を正確に抽出してください。" // プロンプトを追加
                            },
                            {
                                "inlineData": {
                                    "mimeType": mimeType,
                                    "data": base64ImageData
                                }
                            }
                        ]
                    }
                ],
                "systemInstruction": {
                    "parts": [
                        {
                            "text": "カードの画像から、以下の5つのデータを抽出してください。\n1. CardRarity: カード左上の英字 (N, R, SR, SSR のいずれか)\n2. CardType: カード左のタイプ（コスチューム, アクセサリー, サポート, SPアピール のいずれか）\n3. カードID: カード右下のIMTから始まる文字列 (例: IMT-XX-XXX)\n4. カードキャラクター: カード上部のキャラクター名 (日本語表記)\n5. カード名: カード中央付近、左に色の縦棒がある黒背景の帯の中の文字列"
                        }
                    ]
                },
                "generationConfig": {
                    "responseMimeType": "application/json",
                    "responseSchema": {
                        "type": "object",
                        "properties": {
                            "CardRarity": { "type": "string", "enum": ["N", "R", "SR", "SSR"] },
                            "CardType": { "type": "string", "enum": ["コスチューム", "アクセサリー", "サポート", "SPアピール"] },
                            "カードID": { "type": "string" },
                            "カード名": { "type": "string" },
                            "カードキャラクター": { "type": "string" }
                        },
                        "required": ["CardRarity", "CardType", "カードID"] // 最低限これらの情報は必須とする
                    },
                    "temperature": 0.1 // 精度重視で温度を低めに設定
                },
                // 必要に応じて safetySettings を追加
                // "safetySettings": [ ... ]
            };

            const options = {
                'method': 'post',
                'contentType': 'application/json',
                'payload': JSON.stringify(requestBody),
                'muteHttpExceptions': true // APIエラー時もレスポンスを取得するため
            };

            // API呼び出し
            const response = UrlFetchApp.fetch(generateContentEndpoint, options);
            const responseCode = response.getResponseCode();
            const responseBody = response.getContentText();

            Logger.log(`Gemini API Response Code: ${responseCode}`);
            // レスポンスボディが長い場合があるので、全体をログに出すのは注意
            // Logger.log(`Gemini API Response Body: ${responseBody}`);

            if (responseCode === 200) {
                try {
                    const jsonResponse = JSON.parse(responseBody);

                    // レスポンス構造をチェック (generateContent の場合)
                    if (jsonResponse.candidates && jsonResponse.candidates.length > 0 &&
                        jsonResponse.candidates[0].content && jsonResponse.candidates[0].content.parts &&
                        jsonResponse.candidates[0].content.parts.length > 0 &&
                        jsonResponse.candidates[0].content.parts[0].text) {

                        const extractedJsonString = jsonResponse.candidates[0].content.parts[0].text;
                        Logger.log(`Extracted JSON string from Gemini: ${extractedJsonString}`);

                        const cardInfoJson = JSON.parse(extractedJsonString);

                        // 必須項目が存在するか再確認
                        if (cardInfoJson.CardRarity && cardInfoJson.CardType && cardInfoJson.カードID) {
                            // キー名を英語に統一して返す (扱いやすさのため)
                            const cardData = {
                                rarity: cardInfoJson.CardRarity,
                                cardType: cardInfoJson.CardType,
                                cardId: cardInfoJson.カードID,
                                cardName: cardInfoJson.カード名 || null, // 任意項目は null or undefined
                                characterName: cardInfoJson.カードキャラクター || null
                            };
                            Logger.log(`Successfully parsed card info: ${JSON.stringify(cardData)}`);
                            return cardData;
                        } else {
                            Logger.log(`Error: Required fields (Rarity, Type, ID) are missing in the extracted JSON: ${extractedJsonString}`);
                            return null;
                        }

                    } else if (jsonResponse.promptFeedback && jsonResponse.promptFeedback.blockReason) {
                        // コンテンツフィルター等でブロックされた場合
                        const blockReason = jsonResponse.promptFeedback.blockReason;
                        const safetyRatings = JSON.stringify(jsonResponse.promptFeedback.safetyRatings || {});
                        Logger.log(`Gemini request blocked. Reason: ${blockReason}, SafetyRatings: ${safetyRatings}`);
                        throw new Error(`リクエストが拒否されました (${blockReason})。不適切なコンテンツが含まれている可能性があります。`);

                    } else {
                        Logger.log(`Error: Unexpected response structure from Gemini API. Body: ${responseBody.substring(0, 500)}...`); // 最初の500文字だけログに
                        return null;
                    }
                } catch (parseError) {
                    Logger.log(`Error parsing Gemini API response or extracted JSON: ${parseError}`);
                    Logger.log(`Raw response body part: ${responseBody.substring(0, 500)}...`);
                    // JSONパースエラーの場合、元のテキストが返っている可能性もある
                    if (responseBody.includes("API key not valid")) {
                        throw new Error("APIキーが無効です。設定を確認してください。");
                    }
                    return null;
                }
            } else {
                // API呼び出し自体が失敗した場合 (4xx, 5xxエラー)
                Logger.log(`Error: Gemini API returned status code ${responseCode}. Response: ${responseBody.substring(0, 500)}...`);
                if (responseCode === 400) {
                    throw new Error(`Gemini APIリクエストエラー(400): リクエスト内容を確認してください。 ${responseBody}`);
                } else if (responseCode === 429) {
                    throw new Error("Gemini APIの利用制限を超えました。時間をおいて再試行してください。");
                } else if (responseCode >= 500) {
                    throw new Error(`Gemini APIサーバーエラー(${responseCode})。時間をおいて再試行してください。`);
                }
                return null;
            }

        } catch (e) {
            Logger.log(`Exception during Gemini API processing: ${e}`);
            // キャッチしたエラーをそのまま投げることで、呼び出し元(processUploadedImage)にエラーを伝える
            throw e;
        }
    }
};
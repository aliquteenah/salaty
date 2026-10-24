import sharp from 'sharp';

export async function sendTransparentSticker(sock, jid, msg, text) {
    try {
        await sock.sendMessage(jid, { text: "⏳ جاري إنشاء الملصق..." }, { quoted: msg });

        // تنظيف النص وتجنب الأخطاء
        const safeText = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        // إنشاء رسم SVG شفاف مع نص محدد باللون الأبيض والأسود
        const svgImage = `
        <svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
            <style>
                .text {
                    fill: white;
                    stroke: black;
                    stroke-width: 6px;
                    paint-order: stroke fill;
                    font-size: 48px;
                    font-family: sans-serif;
                    font-weight: bold;
                    text-anchor: middle;
                    dominant-baseline: central;
                }
            </style>
            <text x="50%" y="50%" class="text">${safeText}</text>
        </svg>`;

        // تحويل SVG مباشرة إلى بفر WebP شفاف
        const webpBuffer = await sharp(Buffer.from(svgImage))
            .resize(512, 512)
            .webp({ quality: 100 })
            .toBuffer();

        await sock.sendMessage(jid, { sticker: webpBuffer }, { quoted: msg });

    } catch (err) {
        console.log('خطأ معالجة الملصق:', err.message);
        await sock.sendMessage(jid, { text: "❌ حدث خطأ أثناء إنتاج الملصق." }, { quoted: msg });
    }
}

export async function sendHumanTextToSpeech(sock, jid, msg, text, voiceType = 'saliha') {
    await sock.sendMessage(jid, { text: "ℹ️ ميزة تحويل النص إلى صوت غير مفعّلة حالياً على هذا السيرفر." }, { quoted: msg });
}

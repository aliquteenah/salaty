import { createCanvas } from 'canvas';
import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';

export async function sendTransparentSticker(sock, jid, msg, text) {
    const pngPath = path.join(process.cwd(), `temp_${Date.now()}_stk.png`);
    const webpPath = path.join(process.cwd(), `temp_${Date.now()}_stk.webp`);

    try {
        await sock.sendMessage(jid, { text: "⏳ جاري إنشاء الملصق..." }, { quoted: msg });

        // 1. إنشاء قماش ملصق شفاف بحجم 512x512
        const canvas = createCanvas(512, 512);
        const ctx = canvas.getContext('2d');

        ctx.clearRect(0, 0, 512, 512);

        // 2. إعداد الخط والتنسيق النصي
        ctx.font = 'bold 45px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // حدود النص الخارجي باللون الأسود
        ctx.strokeStyle = 'black';
        ctx.lineWidth = 6;
        ctx.strokeText(text, 256, 256);

        // تعبئة النص باللون الأبيض
        ctx.fillStyle = 'white';
        ctx.fillText(text, 256, 256);

        // 3. حفظ الصورة المؤقتة بصيغة PNG
        const buffer = canvas.toBuffer('image/png');
        fs.writeFileSync(pngPath, buffer);

        // 4. تحويل PNG إلى ملصق WebP عالي الجودة بواسطة ffmpeg
        ffmpeg(pngPath)
            .outputOptions([
                '-vcodec libwebp',
                '-vf scale=512:512:force_original_aspect_ratio=increase,crop=512:512'
            ])
            .toFormat('webp')
            .save(webpPath)
            .on('end', async () => {
                if (fs.existsSync(webpPath)) {
                    await sock.sendMessage(jid, { sticker: fs.readFileSync(webpPath) }, { quoted: msg });
                }
                if (fs.existsSync(pngPath)) fs.unlinkSync(pngPath);
                if (fs.existsSync(webpPath)) fs.unlinkSync(webpPath);
            })
            .on('error', async (err) => {
                console.log('خطأ تحويل الملصق بـ FFmpeg:', err.message);
                await sock.sendMessage(jid, { text: "❌ تعذر تحويل الملصق إلى صيغة WebP." }, { quoted: msg });
                if (fs.existsSync(pngPath)) fs.unlinkSync(pngPath);
                if (fs.existsSync(webpPath)) fs.unlinkSync(webpPath);
            });

    } catch (err) {
        console.log('خطأ معالجة الملصق:', err.message);
        await sock.sendMessage(jid, { text: "❌ حدث خطأ أثناء رسم الملصق." }, { quoted: msg });
        if (fs.existsSync(pngPath)) fs.unlinkSync(pngPath);
        if (fs.existsSync(webpPath)) fs.unlinkSync(webpPath);
    }
}

export async function sendHumanTextToSpeech(sock, jid, msg, text, voiceType = 'saliha') {
    await sock.sendMessage(jid, { text: "ℹ️ ميزة تحويل النص إلى صوت موقوفة مؤقتاً لتوفير موارد السيرفر." }, { quoted: msg });
}

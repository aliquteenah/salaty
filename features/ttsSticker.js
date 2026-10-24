import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';

export async function sendTransparentSticker(sock, jid, msg, text) {
    const pngPath = path.join(process.cwd(), `temp_${Date.now()}_stk.png`);
    const webpPath = path.join(process.cwd(), `temp_${Date.now()}_stk.webp`);
    const fontPath = path.join(process.cwd(), 'arabic_font.ttf');

    try {
        await sock.sendMessage(jid, { text: "⏳ جاري تحويل النص إلى ملصق..." }, { quoted: msg });

        const args = ['-background', 'none'];
        if (fs.existsSync(fontPath)) args.push('-font', fontPath);
        args.push(
            '-fill', 'white', '-stroke', 'black', '-strokewidth', '2',
            '-gravity', 'center', '-size', '480x480',
            `caption:${text.startsWith('@') ? ' ' + text : text}`,
            '-extent', '512x512', '-gravity', 'center', pngPath
        );

        execFile('convert', args, (err) => {
            if (err) {
                console.log('⚠️ أداة ImageMagick/convert غير مثبتة على السيرفر الحالي.');
                sock.sendMessage(jid, { text: "❌ تعذر إنتاج الملصق، ميزة الملصقات تحتاج حزمة ImageMagick على السيرفر." }, { quoted: msg });
                return;
            }

            execFile('ffmpeg', ['-y', '-i', pngPath, '-c:v', 'libwebp', webpPath], async (ffErr) => {
                if (!ffErr && fs.existsSync(webpPath)) {
                    await sock.sendMessage(jid, { sticker: fs.readFileSync(webpPath) }, { quoted: msg });
                } else {
                    await sock.sendMessage(jid, { text: "❌ خطأ في معالجة تحويل الملصق." }, { quoted: msg });
                }

                if (fs.existsSync(pngPath)) fs.unlinkSync(pngPath);
                if (fs.existsSync(webpPath)) fs.unlinkSync(webpPath);
            });
        });
    } catch (err) {
        console.log('خطأ معالجة الملصق:', err.message);
        await sock.sendMessage(jid, { text: "❌ حدث خطأ أثناء إنشاء الملصق." }, { quoted: msg });
    }
}

export async function sendHumanTextToSpeech(sock, jid, msg, text, voiceType = 'saliha') {
    const timeStamp = Date.now();
    const mp3Path = path.join(process.cwd(), `temp_speech_${timeStamp}.mp3`);
    const opusPath = path.join(process.cwd(), `temp_speech_${timeStamp}.opus`);

    try {
        const speakerName = voiceType === 'saliha' ? 'صالحة 👩' : 'حامد 👨';
        await sock.sendMessage(jid, { text: `🎙️ جاري توليد الصوت (${speakerName})...` }, { quoted: msg });

        execFile('gtts-cli', ['--lang', 'ar', '--output', mp3Path, '--', text], (err) => {
            if (err || !fs.existsSync(mp3Path)) {
                console.log('⚠️ حزمة gtts-cli غير متاحة أو حدث خطأ في النظام:', err?.message);
                sock.sendMessage(jid, { text: `❌ فشل توليد الصوت (${speakerName}). الخدمة غير مدعومة على البيئة الحالية.` }, { quoted: msg });
                return;
            }

            const audioFilter = voiceType === 'hamed'
                ? 'asetrate=24000*0.8,aresample=24000,atempo=1.25'
                : 'asetrate=24000*1.0,aresample=24000,atempo=1.0';

            execFile('ffmpeg', [
                '-y', '-i', mp3Path, '-af', audioFilter,
                '-c:a', 'libopus', '-b:a', '32k', '-vbr', 'on', opusPath
            ], async (ffErr) => {
                if (!ffErr && fs.existsSync(opusPath)) {
                    await sock.sendMessage(jid, { audio: fs.readFileSync(opusPath), mimetype: 'audio/ogg; codecs=opus', ptt: true }, { quoted: msg });
                } else {
                    await sock.sendMessage(jid, { text: "❌ خطأ في ترميز الصوت مع FFmpeg." }, { quoted: msg });
                }

                if (fs.existsSync(mp3Path)) fs.unlinkSync(mp3Path);
                if (fs.existsSync(opusPath)) fs.unlinkSync(opusPath);
            });
        });
    } catch (err) {
        console.log('خطأ في تحويل الصوت:', err.message);
        await sock.sendMessage(jid, { text: "❌ حدث خطأ أثناء تحويل النص لـ صوت." }, { quoted: msg });
    }
}

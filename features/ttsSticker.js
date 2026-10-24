import axios from 'axios';
import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';

function convertMp3ToOggOpus(inputPath, outputPath, voiceType = 'saliha') {
    return new Promise((resolve, reject) => {
        const audioFilter = voiceType === 'hamed'
            ? 'asetrate=24000*0.8,aresample=24000,atempo=1.25'
            : 'asetrate=24000*1.0,aresample=24000,atempo=1.0';

        ffmpeg(inputPath)
            .audioFilter(audioFilter)
            .toFormat('ogg')
            .audioCodec('libopus')
            .on('end', () => resolve(outputPath))
            .on('error', (err) => reject(err))
            .save(outputPath);
    });
}

export async function sendHumanTextToSpeech(sock, jid, msg, text, voiceType = 'saliha') {
    const timeStamp = Date.now();
    const tempMp3Path = path.join(process.cwd(), `temp_tts_${timeStamp}.mp3`);
    const tempOggPath = path.join(process.cwd(), `temp_tts_${timeStamp}.ogg`);

    try {
        const speakerName = voiceType === 'saliha' ? 'صالحة 👩' : 'حامد 👨';
        await sock.sendMessage(jid, { text: `🎙️ جاري توليد الصوت (${speakerName})...` }, { quoted: msg });

        // جلب الصوت مباشرة من API ترجمة جوجل (بدون حزم خارجية على السيرفر)
        const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=ar&client=tw-ob`;

        const response = await axios({
            method: 'get',
            url: ttsUrl,
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
            },
            timeout: 15000
        });

        fs.writeFileSync(tempMp3Path, response.data);

        await convertMp3ToOggOpus(tempMp3Path, tempOggPath, voiceType);

        if (fs.existsSync(tempOggPath)) {
            await sock.sendMessage(jid, {
                audio: fs.readFileSync(tempOggPath),
                mimetype: 'audio/ogg; codecs=opus',
                ptt: true
            }, { quoted: msg });
        }

    } catch (err) {
        console.log('خطأ تحويل الصوت:', err.message);
        await sock.sendMessage(jid, { text: "❌ تعذر توليد البصمة الصوتية حالياً." }, { quoted: msg });
    } finally {
        if (fs.existsSync(tempMp3Path)) fs.unlinkSync(tempMp3Path);
        if (fs.existsSync(tempOggPath)) fs.unlinkSync(tempOggPath);
    }
}

export async function sendTransparentSticker(sock, jid, msg, text) {
    const tempImgPath = path.join(process.cwd(), `temp_stk_${Date.now()}.png`);
    const tempWebpPath = path.join(process.cwd(), `temp_stk_${Date.now()}.webp`);

    try {
        await sock.sendMessage(jid, { text: "⏳ جاري تحويل النص إلى ملصق..." }, { quoted: msg });

        // توليد صورة نصية شفافة عبر API سريع وخفيف
        const chartUrl = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify({
            type: 'label',
            data: {
                labels: [text],
                datasets: [{ data: [1] }]
            },
            options: {
                plugins: {
                    datalabels: {
                        color: '#FFFFFF',
                        font: { size: 36, weight: 'bold' },
                        textStrokeColor: '#000000',
                        textStrokeWidth: 4
                    }
                }
            }
        }))}&w=512&h=512&bkg=transparent`;

        const response = await axios({ method: 'get', url: chartUrl, responseType: 'arraybuffer', timeout: 15000 });
        fs.writeFileSync(tempImgPath, response.data);

        await new Promise((resolve, reject) => {
            ffmpeg(tempImgPath)
                .toFormat('webp')
                .on('end', resolve)
                .on('error', reject)
                .save(tempWebpPath);
        });

        if (fs.existsSync(tempWebpPath)) {
            await sock.sendMessage(jid, { sticker: fs.readFileSync(tempWebpPath) }, { quoted: msg });
        }

    } catch (err) {
        console.log('خطأ الملصق:', err.message);
        await sock.sendMessage(jid, { text: "❌ تعذر إنشاء الملصق الشفاف حالياً." }, { quoted: msg });
    } finally {
        if (fs.existsSync(tempImgPath)) fs.unlinkSync(tempImgPath);
        if (fs.existsSync(tempWebpPath)) fs.unlinkSync(tempWebpPath);
    }
}

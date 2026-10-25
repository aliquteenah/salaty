import axios from 'axios';
import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';

export const RECITERS = [
    { id: 1, name: 'مشاري العفاسي', edition: 'ar.alafasy' },
    { id: 2, name: 'عبد الباسط عبد الصمد (مرتل)', edition: 'ar.abdulbasitmurattal' },
    { id: 3, name: 'محمود خليل الحصري', edition: 'ar.husary' },
    { id: 4, name: 'سعود الشريم', edition: 'ar.saoodshuraym' },
    { id: 5, name: 'أحمد بن علي العجمي', edition: 'ar.ahmedajamy' },
    { id: 6, name: 'ماهر المعيقلي', edition: 'ar.mahermuaiqly' },
    { id: 7, name: 'عبد الرحمن السديس', edition: 'ar.abdurrahmansudais' },
    { id: 8, name: 'محمد صديق المنشاوي (مرتل)', edition: 'ar.minshawi' },
    { id: 9, name: 'سعد الغامدي', edition: 'ar.ghamadi' },
    { id: 10, name: 'أبو بكر الشاطري', edition: 'ar.shaatree' },
    { id: 11, name: 'ياسر الدوسري', edition: 'ar.yasserdosussary' },
    { id: 12, name: 'ناصر القطامي', edition: 'ar.naserqatami' },
    { id: 13, name: 'محمد أيوب', edition: 'ar.muhammadayyoub' },
    { id: 14, name: 'عبد الله جهني', edition: 'ar.abdullahbasfar' },
    { id: 15, name: 'علي الحذيفي', edition: 'ar.hudhaify' },
    { id: 16, name: 'محمود علي البنا', edition: 'ar.mahmoudalibanna' },
    { id: 17, name: 'صلاح بو خاطر', edition: 'ar.salahbukhatir' },
    { id: 18, name: 'محمد المحيسني', edition: 'ar.muhammadalmuhasny' },
    { id: 19, name: 'هاني الرفاعي', edition: 'ar.hanirifai' },
    { id: 20, name: 'مصطفى إسماعيل', edition: 'ar.mustafaismail' }
];

export const quranState = {};
export const quranTimers = {};
export const sequentialQuranProgress = {};

function convertMp3ToOggOpus(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .toFormat('ogg')
            .audioCodec('libopus')
            .on('end', () => resolve(outputPath))
            .on('error', (err) => reject(err))
            .save(outputPath);
    });
}

export async function sendAyahAndAudio(sock, from, reciter, surahNum = null, ayahNum = null) {
    let url = (surahNum && ayahNum) 
        ? `https://api.alquran.cloud/v1/ayah/${surahNum}:${ayahNum}/${reciter.edition}`
        : `https://api.alquran.cloud/v1/ayah/${Math.floor(Math.random() * 6236) + 1}/${reciter.edition}`;

    const tempMp3Path = path.join(process.cwd(), `temp_${Date.now()}_${Math.floor(Math.random() * 1000)}.mp3`);
    const tempOggPath = path.join(process.cwd(), `temp_${Date.now()}_${Math.floor(Math.random() * 1000)}.ogg`);

    try {
        const response = await axios.get(url, { timeout: 10000 });
        if (!response.data || !response.data.data) {
            await sock.sendMessage(from, { text: '❌ تعذر العثور على الآية المطلوبة، يرجى التأكد من الأرقام المدخلة.' });
            return null;
        }

        const data = response.data.data;
        const caption = `╮───────────────╭ـ
│「❥📲 **القرآن الكريم** 📃❥」
│───────────────╰ـ
*╮ ───═┅─┅─┅═─── ╭*
│⚝ ⃟🎖️❯ 📖 *سورة:* ${data.surah.name}
│⚝ ⃟🧰❯ 🔢 *الآية:* (${data.numberInSurah}/${data.surah.numberOfAyahs})
│⚝ ⃟⚓❯ 🎙️ *القارئ:* ${reciter.name}
│⚝ ⃟💎❯ 
│ ﴿ ${data.text} ﴾
*╯ ───═┅─┅─┅═─── ╰*`;

        await sock.sendMessage(from, { text: caption });

        if (data.audio) {
            try {
                const audioResponse = await axios({ method: 'get', url: data.audio, responseType: 'arraybuffer', timeout: 15000 });
                fs.writeFileSync(tempMp3Path, audioResponse.data);

                try {
                    await convertMp3ToOggOpus(tempMp3Path, tempOggPath);
                    await sock.sendMessage(from, { audio: fs.readFileSync(tempOggPath), mimetype: 'audio/ogg; codecs=opus', ptt: true });
                } catch {
                    await sock.sendMessage(from, { audio: fs.readFileSync(tempMp3Path), mimetype: 'audio/mp4', ptt: false });
                }
            } catch (audioErr) {
                console.error('⚠️ تعذر تحميل الصوت:', audioErr.message);
            }
        }
        return data;
    } catch (err) {
        console.error('خطأ الآية:', err.message);
        await sock.sendMessage(from, { text: '❌ حدث خطأ أثناء جلب الآية.' });
        return null;
    } finally {
        if (fs.existsSync(tempMp3Path)) fs.unlinkSync(tempMp3Path);
        if (fs.existsSync(tempOggPath)) fs.unlinkSync(tempOggPath);
    }
}

export async function sendNextSequentialAyah(sock, targetJid) {
    const prog = sequentialQuranProgress[targetJid];
    if (!prog) return;

    const ayahData = await sendAyahAndAudio(sock, targetJid, prog.reciter, prog.surahNum, prog.currentAyah);

    if (ayahData && ayahData.surah) {
        if (prog.currentAyah >= ayahData.surah.numberOfAyahs) {
            if (quranTimers[targetJid]) {
                clearInterval(quranTimers[targetJid]);
                delete quranTimers[targetJid];
            }
            delete sequentialQuranProgress[targetJid];
            await sock.sendMessage(targetJid, { text: `✅ *تمت بحمد الله تلاوة سورة ${ayahData.surah.name} بالكامل.*` });
        } else {
            prog.currentAyah++;
        }
    }
}

export async function handleQuranCommands(sock, targetJid, text, cleanText, msg) {
    if (cleanText === 'صوت' || cleanText === 'قرآن' || cleanText === 'قران' || cleanText === 'آية' || cleanText === 'ايه') {
        let menuText = `╮───────────────╭ـ
│「❥📲 **قائمة التلاوات** 📃❥」
│───────────────╰ـ
*╮ ───═┅─┅─┅═─── ╭*\n`;
        RECITERS.forEach(r => { menuText += `│⚝ ⃟💎❯ *[ ${r.id} ]* ${r.name}\n`; });
        menuText += `*╯ ───═┅─┅─┅═─── ╰*\n\n`;
        menuText += "📌 *خيارات الإرسال:*\n";
        menuText += "• آية عشوائية: اكتب رقم القارئ (مثال: `1`).\n";
        menuText += "• آية محددة: اكتب `13 2 255` (القارئ، السورة، الآية).\n";
        menuText += "• سورة كاملة: اكتب `13 2د 2` (القارئ، التكرار بالدقائق، السورة).\n\n";
        menuText += "🛑 لإيقاف التلاوة أرسل: *إيقاف القرآن*";

        quranState[targetJid] = { step: 'WAITING_FOR_RECITER' };
        await sock.sendMessage(targetJid, { text: menuText }, { quoted: msg });
        return true;
    }

    if (quranState[targetJid] && quranState[targetJid].step === 'WAITING_FOR_RECITER') {
        const sequentialMatch = text.match(/^(\d+)\s+(\d+)د\s+(\d+)$/i);
        const tripleMatch = text.match(/^(\d+)\s+(\d+)\s+(\d+)$/);
        const repeatMatch = text.match(/^(\d+)(?:\s+(\d+)د)?$/i);

        if (sequentialMatch) {
            const selectedId = parseInt(sequentialMatch[1], 10);
            const minutes = parseInt(sequentialMatch[2], 10);
            const surahNum = parseInt(sequentialMatch[3], 10);
            const reciter = RECITERS.find(r => r.id === selectedId);

            if (reciter && minutes > 0 && surahNum >= 1 && surahNum <= 114) {
                if (quranTimers[targetJid]) {
                    clearInterval(quranTimers[targetJid]);
                    delete quranTimers[targetJid];
                }

                sequentialQuranProgress[targetJid] = { reciter, surahNum, currentAyah: 1 };
                await sock.sendMessage(targetJid, { text: `📖 تم تفعيل تلاوة سورة رقم (${surahNum}) بالترتيب بصوت *${reciter.name}* كل *${minutes}* دقيقة.` }, { quoted: msg });

                await sendNextSequentialAyah(sock, targetJid);
                quranTimers[targetJid] = setInterval(async () => { await sendNextSequentialAyah(sock, targetJid); }, minutes * 60 * 1000);
                delete quranState[targetJid];
                return true;
            }
        } else if (tripleMatch) {
            const selectedId = parseInt(tripleMatch[1], 10);
            const surahNum = parseInt(tripleMatch[2], 10);
            const ayahNum = parseInt(tripleMatch[3], 10);
            const reciter = RECITERS.find(r => r.id === selectedId);

            if (reciter) {
                await sock.sendMessage(targetJid, { text: `⏳ جاري جلب سورة رقم (${surahNum}) الآية (${ayahNum})...` }, { quoted: msg });
                await sendAyahAndAudio(sock, targetJid, reciter, surahNum, ayahNum);
                delete quranState[targetJid];
                return true;
            }
        } else if (repeatMatch) {
            const selectedId = parseInt(repeatMatch[1], 10);
            const minutes = repeatMatch[2] ? parseInt(repeatMatch[2], 10) : null;
            const reciter = RECITERS.find(r => r.id === selectedId);

            if (reciter) {
                if (quranTimers[targetJid]) {
                    clearInterval(quranTimers[targetJid]);
                    delete quranTimers[targetJid];
                    delete sequentialQuranProgress[targetJid];
                }

                if (minutes && minutes > 0) {
                    await sock.sendMessage(targetJid, { text: `⏱️ تم تفعيل التكرار بصوت *${reciter.name}* كل *${minutes}* دقيقة.` }, { quoted: msg });
                    await sendAyahAndAudio(sock, targetJid, reciter);
                    quranTimers[targetJid] = setInterval(async () => { await sendAyahAndAudio(sock, targetJid, reciter); }, minutes * 60 * 1000);
                } else {
                    await sock.sendMessage(targetJid, { text: `⏳ جاري جلب التلاوة...` }, { quoted: msg });
                    await sendAyahAndAudio(sock, targetJid, reciter);
                }
                delete quranState[targetJid];
                return true;
            }
        }
    }
    return false;
}

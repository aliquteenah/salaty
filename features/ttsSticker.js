export async function sendTransparentSticker(sock, jid, msg, text) {
    try {
        await sock.sendMessage(jid, { 
            text: `🎨 *ملصق نصي:*\n\n» ${text} «\n\n_ملاحظة: ميزة الرسام المباشر للملصقات توقفت مؤقتاً لضمان استقرار السيرفر._` 
        }, { quoted: msg });
    } catch (err) {
        console.log('خطأ الملصق:', err.message);
    }
}

export async function sendHumanTextToSpeech(sock, jid, msg, text, voiceType = 'saliha') {
    try {
        await sock.sendMessage(jid, { 
            text: `🎙️ *تحويل النص:*\n\n» ${text} «` 
        }, { quoted: msg });
    } catch (err) {
        console.log('خطأ تحويل الصوت:', err.message);
    }
}

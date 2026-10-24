import pino from 'pino';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { unwrap, getType, getText } from '../utils/helpers.js';

export const messageStore = new Map();
export const mediaStore = new Map();
const MEDIA_TYPES = ['imageMessage', 'videoMessage', 'stickerMessage', 'audioMessage', 'documentMessage'];
const KEEP_MS = 30 * 60 * 1000;
const MAX_MEDIA_SIZE = 15 * 1024 * 1024;

export async function saveMedia(sock, msg, content) {
    if (msg.key.fromMe) return;

    const mType = MEDIA_TYPES.find((t) => content[t]);
    if (!mType || !content[mType].mediaKey || !content[mType].mediaKey.length) return;

    const size = Number(String(content[mType].fileLength || 0));
    if (size > MAX_MEDIA_SIZE) return;

    try {
        const buffer = await downloadMediaMessage(
            { key: msg.key, message: content }, 'buffer', {},
            { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
        );

        mediaStore.set(msg.key.id, {
            buffer,
            type: mType,
            mimetype: content[mType].mimetype,
            ptt: content[mType].ptt,
            caption: content[mType].caption || '',
            fileName: content[mType].fileName
        });
        setTimeout(() => mediaStore.delete(msg.key.id), KEEP_MS);
    } catch (e) {
        console.log('تعذر حفظ الوسيط:', e.message);
    }
}

async function resendMedia(sock, jid, sender, media, title) {
    const senderClean = sender.split('@')[0];
    const header = `${title}\n👤 *المرسل:* @${senderClean}`;
    const mentions = [sender];

    switch (media.type) {
        case 'imageMessage':
            await sock.sendMessage(jid, { image: media.buffer, caption: `${header}\n\n${media.caption}`, mentions });
            break;
        case 'videoMessage':
            await sock.sendMessage(jid, { video: media.buffer, caption: `${header}\n\n${media.caption}`, mentions });
            break;
        case 'stickerMessage':
            await sock.sendMessage(jid, { text: header, mentions });
            await sock.sendMessage(jid, { sticker: media.buffer });
            break;
        case 'audioMessage':
            await sock.sendMessage(jid, { text: header, mentions });
            await sock.sendMessage(jid, { audio: media.buffer, mimetype: media.mimetype, ptt: media.ptt });
            break;
        case 'documentMessage':
            await sock.sendMessage(jid, { document: media.buffer, mimetype: media.mimetype, fileName: media.fileName || 'file', caption: header, mentions });
            break;
    }
}

export async function handleAntiDeleteAndEdit(sock, msg, proto) {
    const targetJid = msg.key.remoteJid;
    const outJid = targetJid; 

    if (proto.type === 0) {
        const deletedKey = proto.key;
        const savedMsg = messageStore.get(deletedKey.id);
        const savedMedia = mediaStore.get(deletedKey.id);

        if (savedMsg) {
            const sender = savedMsg.key.participant || savedMsg.key.remoteJid;
            const senderClean = sender.split('@')[0];
            const content = savedMsg.message;
            const mType = getType(content);

            try {
                if (mType === 'conversation' || mType === 'extendedTextMessage') {
                    await sock.sendMessage(outJid, {
                        text: `⚠️ *تم كشف رسالة نصية محذوفة!*\n👤 *المرسل:* @${senderClean}\n\n💬 *النص:* ${getText(content)}`,
                        mentions: [sender]
                    });
                } else if (savedMedia) {
                    await resendMedia(sock, outJid, sender, savedMedia, '⚠️ *تم كشف وسيط محذوف!*');
                    mediaStore.delete(deletedKey.id);
                }
            } catch (e) {
                console.log('خطأ كشف المحذوف:', e.message);
            }
        }
    }
    else if (proto.type === 14 && !msg.key.fromMe) {
        const editedId = proto.key?.id;
        const saved = messageStore.get(editedId);
        const newContent = unwrap(proto.editedMessage || {});
        const newText = getText(newContent);

        if (saved && newText) {
            const oldText = getText(saved.message);
            if (oldText && oldText !== newText) {
                const sender = saved.key.participant || saved.key.remoteJid;
                const senderClean = sender.split('@')[0];
                try {
                    await sock.sendMessage(outJid, {
                        text: `✏️ *تم كشف رسالة معدّلة!*\n👤 *المرسل:* @${senderClean}\n\n📝 *قبل:* ${oldText}\n\n✅ *بعد:* ${newText}`,
                        mentions: [sender]
                    });
                } catch (e) {
                    console.log('خطأ كشف التعديل:', e.message);
                }
            }
            messageStore.set(editedId, { key: saved.key, message: newContent });
        }
    }
}

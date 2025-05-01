// Import modul yang diperlukan
const express = require('express');
const Fuse = require('fuse.js');

// Load data percakapan dari file JSON
// Pastikan file chatData.json ada di direktori yang sama dan valid (tanpa komentar)
let chatData;
try {
    chatData = require('./chatData.json');
} catch (error) {
    console.error("==============================================");
    console.error("ERROR: Gagal memuat atau parse chatData.json!");
    console.error("Pastikan file ada, tidak kosong, dan format JSON valid (tidak ada komentar!).");
    console.error("Error Detail:", error.message);
    console.error("==============================================");
    // Hentikan aplikasi jika data krusial gagal dimuat
    process.exit(1);
}


// Inisialisasi aplikasi Express
const app = express();

// --- State Aplikasi (Simpan di memori - akan reset jika server restart) ---
let currentContext = null;      // Konteks percakapan saat ini
let lastUserMessage = null;     // Pesan terakhir dari pengguna (untuk cek pengulangan & reset konteks)
let lastMatchedRuleId = null;   // ID rule terakhir yang cocok (untuk cek pengulangan)
let userName = null;            // Nama pengguna (jika sudah diberikan)
let reminders = [];             // Daftar pengingat sederhana

// --- Pengurutan Aturan & Inisialisasi Fuse.js ---
const sortedChatData = chatData
    .filter(rule => rule.priority >= 0) // Abaikan rule data seperti 'suggestions'
    .sort((a, b) => b.priority - a.priority); // Urutkan dari prioritas tertinggi ke terendah

const allKeywordsData = sortedChatData.flatMap(item =>
    item.keywords.map(kw => ({ keyword: kw, id: item.id, priority: item.priority }))
);

const fuseOptions = {
    includeScore: true,
    threshold: 0.4, // Tingkat toleransi typo (0=ketat, 1=longgar)
    keys: ['keyword'],
    ignoreLocation: true,
    distance: 100,
};

const fuse = new Fuse(allKeywordsData, fuseOptions);

// --- Fungsi Bantuan ---
function getRandomElement(arr) {
    if (!arr || arr.length === 0) return null;
    return arr[Math.floor(Math.random() * arr.length)];
}

function getGreetingByTime() {
    // Dapatkan waktu berdasarkan zona waktu Asia/Jakarta
    const options = { timeZone: 'Asia/Jakarta', hour: 'numeric', hour12: false };
    const formatter = new Intl.DateTimeFormat('en-US', options);
    const hour = parseInt(formatter.format(new Date()), 10);

    if (hour >= 4 && hour < 11) return "Selamat pagi";
    if (hour >= 11 && hour < 15) return "Selamat siang";
    if (hour >= 15 && hour < 18) return "Selamat sore";
    return "Selamat malam";
}

const suggestionData = chatData.find(item => item.id === 'suggestions')?.data || [];

// --- Fungsi Dynamic Answers (Untuk Jawaban yang Membutuhkan Logika) ---
const dynamicAnswerFunctions = {
    sapaanWaktuAkurat: () => {
        const greeting = getGreetingByTime();
        const namePart = userName ? ` ${userName}` : ''; // Tambah nama jika ada
        return `${greeting}${namePart}! Ada yang bisa dibantu?`;
    },
    sapaanWaktuUmum: () => {
        const greeting = getGreetingByTime();
        const namePart = userName ? ` ${userName}` : '';
        const baseAnswers = chatData.find(item => item.id === 'sapaanUmum')?.answers;
        let randomBaseAnswer = getRandomElement(baseAnswers) || "Ada yang bisa saya bantu?";
        // Hindari pengulangan sapaan waktu jika base answer sudah mengandungnya
        if (/pagi|siang|sore|malam/.test(randomBaseAnswer.toLowerCase())) {
             return `${randomBaseAnswer.replace(/^(Halo|Hai|Yo|Tes)\s*/i, '')}${namePart}!`; // Ganti sapaan asli dgn yg ada nama
        }
        return `${greeting}! ${randomBaseAnswer}${namePart}.`;
    },
    fallbackDenganSaran: () => {
        const baseFallbackAnswers = chatData.find(item => item.id === 'fallback')?.answers;
        let reply = getRandomElement(baseFallbackAnswers) || "Maaf, saya tidak mengerti.";
        if (suggestionData.length > 0) {
            const suggestions = [];
            const count = Math.min(3, suggestionData.length);
            const tempSuggestions = [...suggestionData];
            for (let i = 0; i < count; i++) {
                const randomIndex = Math.floor(Math.random() * tempSuggestions.length);
                suggestions.push(`'${tempSuggestions.splice(randomIndex, 1)[0]}'`);
            }
            reply += ` Mungkin Anda bisa mencoba: ${suggestions.join(', ')}?`;
        }
        return reply;
    },
    jawabWaktuTanggal: () => {
        const now = new Date();
        const timeOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Jakarta', hour12: false };
        const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Jakarta' };
        const currentTime = now.toLocaleTimeString('id-ID', timeOptions);
        const currentDate = now.toLocaleDateString('id-ID', dateOptions);
        return `Menurut jam saya di zona waktu Jakarta, sekarang pukul ${currentTime} WIB, tanggal ${currentDate}.`;
    },
    tanyaNamaPengguna: () => {
        if (userName) {
            return `Saya sudah tahu kok, nama Anda ${userName}. Ada lagi?`;
        } else {
            currentContext = "menanyakanNama"; // Set konteks
            return "Saya belum tahu nama Anda. Boleh beritahu siapa nama Anda?";
        }
    },
    simpanDanSapaNama: (message) => {
        // Coba ekstrak nama dari pesan, hapus kata kunci pemicu
        const nameKeywords = ["nama saya", "namaku", "panggil aku", "saya"];
        let extractedName = message.toLowerCase();
        for (const kw of nameKeywords) {
            if (extractedName.startsWith(kw)) {
                extractedName = extractedName.substring(kw.length).trim();
                break; // Hanya hapus satu keyword pemicu
            }
        }
        // Ambil kata pertama sebagai nama (asumsi sederhana)
        extractedName = extractedName.split(' ')[0];
        // Kapitalisasi huruf pertama
        if (extractedName) {
             userName = extractedName.charAt(0).toUpperCase() + extractedName.slice(1);
             return `Oke, halo ${userName}! Senang mengenal Anda. Ada yang bisa saya bantu?`;
        } else {
             return "Hmm, sepertinya saya tidak menangkap nama Anda dengan jelas. Bisa ulangi?";
             // Seharusnya tidak sampai sini jika context 'menanyakanNama' aktif, tapi sebagai fallback
        }
    },
    tambahPengingat: (message) => {
        const addKeywords = ["ingatkan saya", "buat pengingat", "tambah reminder", "catat"];
        let reminderText = message;
        for (const kw of addKeywords) {
             if (reminderText.toLowerCase().startsWith(kw)) {
                 reminderText = reminderText.substring(kw.length).trim();
                 break;
             }
        }

        if (reminderText) {
             reminders.push(reminderText);
             return `Baik, sudah saya catat pengingat: "${reminderText}". Katakan 'lihat pengingat' untuk mengeceknya.`;
        } else {
             return "Oke, mau saya ingatkan tentang apa?";
        }
    },
    tampilkanPengingat: () => {
        if (reminders.length === 0) {
             return "Anda belum memiliki pengingat saat ini.";
        } else {
             const reminderList = reminders.map((r, index) => `${index + 1}. ${r}`).join('\n');
             return `Berikut daftar pengingat Anda:\n${reminderList}\n\nKatakan 'hapus pengingat' untuk membersihkan daftar.`;
        }
    },
    hapusSemuaPengingat: () => {
         if (reminders.length === 0) {
             return "Tidak ada pengingat yang perlu dihapus.";
         } else {
             const count = reminders.length;
             reminders = []; // Kosongkan array
             return `Oke, ${count} pengingat telah dihapus.`;
         }
    }
};

// --- Rute Utama Chatbot ---
app.get('/chat', (req, res) => {
    const userMessage = req.query.message;

    // Validasi input
    if (!userMessage || typeof userMessage !== 'string' || userMessage.trim() === '') {
        return res.status(400).json({ error: 'Parameter "message" diperlukan dan tidak boleh kosong.' });
    }

    const normalizedMessage = userMessage.toLowerCase().trim();
    let reply = null;
    let matchedRule = null;
    let matchType = 'none'; // 'exact', 'fuse', 'fallback', 'repeat'
    let fuseMatchDetails = null;
    const previousContext = currentContext; // Simpan konteks sebelum diproses

    console.log(`\n--- Request Baru ---`);
    console.log(`Timestamp: ${new Date().toISOString()}`);
    console.log(`Pesan Diterima: "${userMessage}" (Normalized: "${normalizedMessage}")`);
    console.log(`Konteks Awal: ${currentContext}, Nama: ${userName}, Pengingat: ${reminders.length}`);

    // --- Pembersihan Konteks Otomatis ---
    // Hapus konteks jika pesan berubah DAN konteks ada DAN BUKAN konteks menunggu nama
    // (agar user bisa langsung jawab nama tanpa dianggap ganti topik)
    if (currentContext && currentContext !== "menanyakanNama" && lastUserMessage && normalizedMessage !== lastUserMessage.toLowerCase().trim()) {
        console.log(`Pesan berubah & ada konteks (${currentContext}), konteks dihapus.`);
        currentContext = null;
    }

    // --- Deteksi Pengulangan Pertanyaan ---
    const isRepeating = lastUserMessage && normalizedMessage === lastUserMessage.toLowerCase().trim() && lastMatchedRuleId && lastMatchedRuleId !== 'fallback';
    if (isRepeating) {
        console.log(`Deteksi Pengulangan untuk Rule ID: ${lastMatchedRuleId}`);
        matchType = 'repeat';
        // Beri jawaban variasi atau acknowledgment
        const repeatAnswers = [
            "Seperti yang saya sebutkan sebelumnya...",
            "Saya sudah menjawab itu, tapi oke...",
            "Mungkin ada bagian yang kurang jelas? Intinya adalah...",
            "Sekali lagi ya...",
        ];
        const originalRule = sortedChatData.find(r => r.id === lastMatchedRuleId);
        if (originalRule) {
            let originalAnswer;
             if (originalRule.dynamicAnswer && dynamicAnswerFunctions[originalRule.dynamicAnswer]) {
                 // Hati-hati jika dynamic answer bergantung pada message asli
                 try {
                    // Coba panggil dengan message asli jika fungsi menerimanya
                    originalAnswer = dynamicAnswerFunctions[originalRule.dynamicAnswer](userMessage);
                 } catch (e) {
                    // Jika error atau tidak menerima argumen
                    originalAnswer = dynamicAnswerFunctions[originalRule.dynamicAnswer]();
                 }
             } else {
                 originalAnswer = getRandomElement(originalRule.answers);
             }
            reply = `${getRandomElement(repeatAnswers)} ${originalAnswer || 'tidak ada jawaban spesifik.'}`;
        } else {
            reply = "Anda menanyakan hal yang sama lagi."; // Fallback jika rule asli tidak ketemu
        }
    }

    // --- Proses Pencocokan Aturan (Hanya jika bukan pengulangan) ---
    if (matchType !== 'repeat') {
        // 1. Cari Kecocokan Exact Keyword (Prioritaskan yang lebih panjang & prioritas tinggi)
        let exactMatchFound = false;
        const potentialExactMatches = [];
        for (const rule of sortedChatData) {
            const matchingKeywords = rule.keywords
                .filter(kw => normalizedMessage.includes(kw.toLowerCase()))
                .sort((a, b) => b.length - a.length);

            if (matchingKeywords.length > 0) {
                potentialExactMatches.push({ rule, matchedKeyword: matchingKeywords[0] });
            }
        }

        if (potentialExactMatches.length > 0) {
            potentialExactMatches.sort((a, b) => {
                if (b.rule.priority !== a.rule.priority) return b.rule.priority - a.rule.priority;
                return b.matchedKeyword.length - a.matchedKeyword.length;
            });

            const bestExactMatch = potentialExactMatches.find(match => !match.rule.requiredContext || match.rule.requiredContext === currentContext);

            if (bestExactMatch) {
                matchedRule = bestExactMatch.rule;
                matchType = 'exact';
                exactMatchFound = true;
                console.log(`Exact Match Ditemukan: Rule ID '${matchedRule.id}', Keyword '${bestExactMatch.matchedKeyword}', Prioritas ${matchedRule.priority}`);
            } else {
                 console.log(`Exact Match ditemukan tapi konteks tidak cocok. Kandidat teratas: Rule ID '${potentialExactMatches[0].rule.id}' (membutuhkan: ${potentialExactMatches[0].rule.requiredContext}, saat ini: ${currentContext})`);
            }
        }

        // 2. Jika tidak ada Exact Match, Coba Fuse.js
        if (!exactMatchFound) {
            const fuseResult = fuse.search(normalizedMessage);
            // console.log(`Fuse.js results raw: ${fuseResult.length > 0 ? fuseResult.slice(0, 5).map(r => `${r.item.id}(${r.score.toFixed(2)})`).join(', ') : 'None'}`);

            if (fuseResult.length > 0) {
                const validFuseMatches = fuseResult
                    .filter(r => r.score <= fuseOptions.threshold)
                    .map(r => ({ ...r, rule: sortedChatData.find(rule => rule.id === r.item.id) }))
                    .filter(r => r.rule && (!r.rule.requiredContext || r.rule.requiredContext === currentContext));

                if (validFuseMatches.length > 0) {
                     validFuseMatches.sort((a, b) => {
                         if (a.score !== b.score) return a.score - b.score;
                         return b.rule.priority - a.rule.priority;
                     });
                     const bestFuseMatch = validFuseMatches[0];
                     matchedRule = bestFuseMatch.rule;
                     matchType = 'fuse';
                     fuseMatchDetails = { corrected: bestFuseMatch.item.keyword, score: bestFuseMatch.score };
                     console.log(`Fuse Match Dipilih: Rule ID '${matchedRule.id}', Koreksi '${fuseMatchDetails.corrected}', Skor ${fuseMatchDetails.score.toFixed(3)}, Prioritas ${matchedRule.priority}`);
                } else {
                    console.log("Hasil Fuse.js ada, tapi skor terlalu tinggi atau konteks tidak cocok.");
                }
            }
        }

        // 3. Jika Masih Tidak Ada Match, Gunakan Fallback Rule
        if (!matchedRule) {
            matchedRule = sortedChatData.find(rule => rule.id === 'fallback');
            if (matchedRule) {
                 matchType = 'fallback';
                 console.log("Tidak ada match spesifik, menggunakan Fallback Rule.");
                 if (currentContext && !matchedRule.requiredContext) {
                     console.log(`Konteks (${currentContext}) dihapus karena fallback.`);
                     currentContext = null;
                 }
            } else {
                // Fallback darurat jika rule 'fallback' tidak ditemukan di JSON
                reply = "Maaf, terjadi sedikit masalah pada sistem internal saya.";
                 console.error("FATAL: Rule 'fallback' tidak ditemukan di chatData.json!");
                 matchType = 'error';
                 currentContext = null;
            }
        }

        // --- Hasilkan Jawaban & Atur Konteks (jika bukan error) ---
        if (matchedRule && matchType !== 'error') {
            // Hasilkan Jawaban
            if (matchedRule.dynamicAnswer && dynamicAnswerFunctions[matchedRule.dynamicAnswer]) {
                try {
                    // Panggil fungsi dynamic, kirim 'userMessage' asli jika fungsi membutuhkannya
                    const dynamicFunc = dynamicAnswerFunctions[matchedRule.dynamicAnswer];
                    // Cek apakah fungsi menerima argumen (cara sederhana)
                    if (dynamicFunc.length > 0) {
                        reply = dynamicFunc(userMessage);
                    } else {
                        reply = dynamicFunc();
                    }
                     console.log(`Dynamic Answer dari fungsi '${matchedRule.dynamicAnswer}' untuk Rule ID '${matchedRule.id}'`);
                } catch (error) {
                    console.error(`Error menjalankan dynamicAnswer '${matchedRule.dynamicAnswer}' untuk Rule ID ${matchedRule.id}:`, error);
                    reply = getRandomElement(matchedRule.answers) || "Maaf, ada sedikit gangguan saat memproses jawaban.";
                }
            } else {
                reply = getRandomElement(matchedRule.answers);
                console.log(`Static Answer dipilih untuk Rule ID '${matchedRule.id}'`);
            }

            // Atur atau Hapus Konteks berdasarkan rule yang cocok
            // Perhatikan: Konteks mungkin sudah diubah di dalam dynamic function (misal: tanyaNamaPengguna)
            // Rule ini hanya menangani set/clear eksplisit di JSON
            if (matchedRule.setContext && currentContext !== matchedRule.setContext) {
                 // Hanya set jika belum di-set oleh dynamic function ke nilai yg sama
                currentContext = matchedRule.setContext;
                console.log(`Konteks diatur ke: ${currentContext} oleh Rule ID '${matchedRule.id}'`);
            } else if (matchedRule.clearContext && currentContext !== null) {
                 // Hanya clear jika belum di-clear oleh dynamic function
                console.log(`Konteks (${currentContext}) dihapus oleh Rule ID '${matchedRule.id}'`);
                currentContext = null;
            } else if (!matchedRule.setContext && !matchedRule.clearContext && previousContext !== null && matchType !== 'fallback') {
                 // Jika rule tidak mengubah konteks, dan konteks sebelumnya ada (dan bukan fallback),
                 // Pertahankan konteks sebelumnya (kecuali sudah dihapus otomatis di awal)
                 if (currentContext === null) currentContext = previousContext; // Kembalikan jika terhapus otomatis
                 console.log(`Konteks (${currentContext}) dipertahankan/dikembalikan untuk Rule ID '${matchedRule.id}'.`);
            }

            // Simpan ID rule yang cocok untuk deteksi pengulangan berikutnya
            lastMatchedRuleId = matchedRule.id;

        } // end if(matchedRule && matchType !== 'error')

    } // end if(matchType !== 'repeat')

    // Simpan pesan terakhir pengguna
    lastUserMessage = userMessage;

     // --- Kirim Respons ---
     console.log(`Jawaban Dikirim: "${reply ? reply.substring(0, 100) : 'null'}..."`); // Log sebagian jawaban
     console.log(`Konteks Akhir: ${currentContext}, Nama: ${userName}, Pengingat: ${reminders.length}`);
     console.log(`Match Type: ${matchType}, Matched Rule ID: ${lastMatchedRuleId}`);
     console.log(`--- Akhir Request ---`);

     res.json({
         query: userMessage,
         reply: reply || "Maaf, saya tidak dapat memberikan jawaban saat ini.", // Pastikan selalu ada balasan
         match_details: {
             type: matchType,
             rule_id: lastMatchedRuleId, // Gunakan ID terakhir yang cocok (termasuk repeat)
             priority: matchedRule ? matchedRule.priority : null,
             context_before: previousContext,
             context_after: currentContext,
             user_name: userName,
             reminder_count: reminders.length,
             fuse_info: matchType === 'fuse' ? fuseMatchDetails : null
         }
     });
});

// Rute default untuk cek server
app.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(`
        <h1>Server Chatbot Express.js (v3) Aktif!</h1>
        <p>Gunakan endpoint <code>/chat?message=pesan_anda</code> untuk berinteraksi.</p>
        <p>Contoh:</p>
        <ul>
            <li><a href="/chat?message=halo" target="_blank">/chat?message=halo</a></li>
            <li><a href="/chat?message=jam%20berapa" target="_blank">/chat?message=jam berapa</a></li>
            <li><a href="/chat?message=siapa%20namaku" target="_blank">/chat?message=siapa namaku</a></li>
            <li><a href="/chat?message=nama%20saya%20Budi" target="_blank">/chat?message=nama saya Budi</a> (Setelah ditanya nama)</li>
            <li><a href="/chat?message=ingatkan%20saya%20beli%20kopi" target="_blank">/chat?message=ingatkan saya beli kopi</a></li>
            <li><a href="/chat?message=lihat%20pengingat" target="_blank">/chat?message=lihat pengingat</a></li>
             <li><a href="/chat?message=apa%20itu%20node.js" target="_blank">/chat?message=apa itu node.js</a></li>
             <li><a href="/chat?message=lupakan%20topik" target="_blank">/chat?message=lupakan topik</a></li>
        </ul>
        <p><em>Server time: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB</em></p>
    `);
});

// Middleware untuk menangani error 404 (Not Found)
app.use((req, res, next) => {
  res.status(404).json({ error: 'Endpoint tidak ditemukan. Gunakan /chat' });
});

// Middleware untuk menangani error server (500)
app.use((err, req, res, next) => {
  console.error("================ SERVER ERROR ================");
  console.error(err.stack);
  console.error("============================================");
  res.status(500).json({ error: 'Terjadi kesalahan internal pada server.' });
});

module.exports = app;
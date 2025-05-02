// Import modul yang diperlukan
const express = require('express');
const Fuse = require('fuse.js');

// Load data percakapan dari file JSON
let chatData;
try {
    // Gunakan path relatif yang benar
    chatData = require('./chatData.json');
    console.log(`[OK] chatData.json berhasil dimuat.`);
} catch (error) {
    console.error("==============================================");
    console.error("ERROR FATAL: Gagal memuat atau parse chatData.json!");
    console.error("Pastikan file 'chatData.json' ada di direktori yang sama dengan index.js,");
    console.error("tidak kosong, dan format JSON-nya 100% valid (tidak ada koma di akhir, tidak ada komentar).");
    console.error("Error Detail:", error.message);
    console.error("==============================================");
    process.exit(1); // Hentikan aplikasi jika data krusial gagal dimuat
}


// Inisialisasi aplikasi Express
const app = express();
const port = process.env.PORT || 3000;

// --- State Aplikasi (Simpan di memori - reset jika server restart) ---
let currentContext = null;
let lastUserMessage = null;
let lastMatchedRuleId = null;
let lastBotReply = null;
let userName = null;
let reminders = [];
let userPreferences = { favColor: null }; // Menyimpan preferensi user
let quizState = null; // null | { currentQuestion: number, score: number, questions: array }
let troubleshootingState = null; // null | { flow: string, step: number, history: array }
let currentBotMood = 'netral'; // 'netral', 'ceria', 'sedikit_lelah'

// --- Pengurutan Aturan & Inisialisasi Fuse.js ---
const sortedChatData = chatData
    .filter(rule => rule.priority >= 0)
    .sort((a, b) => b.priority - a.priority);

const allKeywordsData = sortedChatData.flatMap(item =>
    item.keywords.map(kw => ({ keyword: kw, id: item.id, priority: item.priority }))
);

const fuseOptions = {
    includeScore: true,
    threshold: 0.4,
    keys: ['keyword'],
    ignoreLocation: true,
    distance: 100,
};

const fuse = new Fuse(allKeywordsData, fuseOptions);

// --- Fungsi Bantuan & Logika Tambahan ---
function getRandomElement(arr) {
    if (!arr || arr.length === 0) return null;
    return arr[Math.floor(Math.random() * arr.length)];
}

function getGreetingByTime() {
    const options = { timeZone: 'Asia/Jakarta', hour: 'numeric', hour12: false };
    const formatter = new Intl.DateTimeFormat('en-US', options);
    const hour = parseInt(formatter.format(new Date()), 10);
    if (hour >= 4 && hour < 11) return "Selamat pagi";
    if (hour >= 11 && hour < 15) return "Selamat siang";
    if (hour >= 15 && hour < 18) return "Selamat sore";
    if (hour >= 18 && hour < 21) return "Selamat malam";
    return "Selamat larut malam"; // Tambahan
}

// Fungsi untuk memilih jawaban, bisa dipengaruhi mood bot
function selectAnswer(rule) {
    let baseAnswers = rule.answers;
    let selectedAnswer = getRandomElement(baseAnswers);

    // Modifikasi jawaban berdasarkan mood (contoh sederhana)
    if (currentBotMood === 'ceria' && selectedAnswer) {
        selectedAnswer += getRandomElement(["!", " :)", " Semangat!"]);
    } else if (currentBotMood === 'sedikit_lelah' && selectedAnswer) {
         selectedAnswer += getRandomElement(["...", " *menghela napas*", " ya begitu."]);
    }

    // Personalisasi sederhana
    if (userName && selectedAnswer && Math.random() < 0.2) { // 20% chance
         selectedAnswer = `${userName}, ${selectedAnswer.charAt(0).toLowerCase() + selectedAnswer.slice(1)}`;
    }
     if (userPreferences.favColor && selectedAnswer && Math.random() < 0.1) { // 10% chance
         selectedAnswer += ` Ngomong-ngomong, ${userPreferences.favColor} itu warna yang bagus!`;
     }

    return selectedAnswer;
}

// Fungsi untuk sesekali mengubah mood bot
function updateBotMood() {
    const rand = Math.random();
    if (rand < 0.1) { // 10% chance lelah
        currentBotMood = 'sedikit_lelah';
        console.log("[MOOD UPDATE] Bot merasa sedikit lelah.");
    } else if (rand < 0.3) { // 20% chance ceria (total 30%)
        currentBotMood = 'ceria';
         console.log("[MOOD UPDATE] Bot merasa ceria!");
    } else { // 70% chance netral
        if (currentBotMood !== 'netral') {
             currentBotMood = 'netral';
              console.log("[MOOD UPDATE] Bot kembali netral.");
        }
    }
}


const suggestionData = chatData.find(item => item.id === 'suggestions')?.data || [];

// --- Definisi Pertanyaan Kuis ---
const kuisTrivia = [
    { q: "Apa ibukota Indonesia?", a: "jakarta", o: ["jakarta", "bandung", "surabaya"] },
    { q: "Gunung tertinggi di Pulau Jawa?", a: "semeru", o: ["merapi", "semeru", "slamet"] },
    { q: "Siapa presiden pertama Indonesia?", a: "soekarno", o: ["hatta", "soeharto", "soekarno"] }
];

// --- Fungsi Dynamic Answers ---
const dynamicAnswerFunctions = {
    sapaanWaktuAkurat: () => {
        const greeting = getGreetingByTime();
        const namePart = userName ? ` ${userName}` : '';
        const matchedGreeting = ["assalamualaikum", "shalom", "om swastiastu"].find(g => lastUserMessage?.toLowerCase().includes(g));
        const specificReply = matchedGreeting === "assalamualaikum" ? "Waalaikumsalam!" : matchedGreeting === "shalom" ? "Shalom aleichem!" : matchedGreeting === "om swastiastu" ? "Om shanti shanti shanti om." : null;
        const mainGreeting = specificReply || `${greeting}${namePart}!`;
        return selectAnswer({ answers: [`${mainGreeting} Ada yang bisa dibantu?`] }); // Gunakan selectAnswer
    },
    sapaanWaktuUmum: () => {
        const greeting = getGreetingByTime();
        const namePart = userName ? ` ${userName}` : '';
        const baseAnswers = chatData.find(item => item.id === 'sapaanUmum')?.answers;
        let randomBaseAnswer = getRandomElement(baseAnswers) || "Ada yang bisa saya bantu?";
        if (/pagi|siang|sore|malam/.test(randomBaseAnswer.toLowerCase())) {
             return selectAnswer({ answers: [`${randomBaseAnswer.replace(/^(Halo|Hai|Yo|Tes|Punten)\s*/i, '')}${namePart}!`] });
        }
        return selectAnswer({ answers: [`${greeting}! ${randomBaseAnswer}${namePart}.`] });
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
            reply += ` Mungkin Anda bisa mencoba: ${suggestions.join(', ')} atau tanya 'bantuan'?`;
        }
        return selectAnswer({ answers: [reply] }); // Gunakan selectAnswer
    },
    jawabWaktuTanggal: () => {
        const now = new Date();
        const timeOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Jakarta', hour12: false };
        const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Jakarta' };
        const currentTime = now.toLocaleTimeString('id-ID', timeOptions);
        const currentDate = now.toLocaleDateString('id-ID', dateOptions);
        return selectAnswer({ answers: [`Menurut jam sistem saya (WIB), sekarang pukul ${currentTime}, tanggal ${currentDate}.`] });
    },
     jawabPerasaanBot: () => {
         const rule = chatData.find(r => r.id === 'tanyaPerasaanBot');
         let baseAnswer = selectAnswer(rule); // Dapatkan jawaban dasar + potensi mood
         // Tambahkan info mood aktual
         baseAnswer += ` Saat ini mood saya sedang '${currentBotMood}'.`;
         return baseAnswer;
     },
    tanyaNamaPengguna: () => {
        if (userName) {
            return selectAnswer({ answers: [`Tentu saja saya ingat, nama Anda ${userName}. Ada lagi?`] });
        } else {
            currentContext = "menanyakanNama";
            return selectAnswer({ answers: ["Saya belum tahu nama Anda. Boleh beritahu siapa nama panggilan Anda?"] });
        }
    },
    simpanDanSapaNama: (message) => {
        const nameKeywords = ["nama saya", "namaku", "panggil aku", "saya", "aku"];
        let extractedName = message.toLowerCase();
        for (const kw of nameKeywords) {
            if (extractedName.startsWith(kw)) {
                extractedName = extractedName.substring(kw.length).trim();
                break;
            }
        }
        extractedName = extractedName.split(' ')[0];
        if (extractedName) {
             userName = extractedName.charAt(0).toUpperCase() + extractedName.slice(1);
             return selectAnswer({ answers: [`Oke, halo ${userName}! Senang berkenalan. Ada yang bisa dibantu selanjutnya?`] });
        } else {
             currentContext = "menanyakanNama";
             return selectAnswer({ answers: ["Hmm, kurang jelas. Bisa sebutkan nama panggilan Anda saja?"] });
        }
    },
    tanyaWarnaFavorit: () => {
         if (userPreferences.favColor) {
             return selectAnswer({ answers: [`Saya ingat kok, warna favorit Anda adalah ${userPreferences.favColor}. Indah!`] });
         } else {
             currentContext = "menanyakanWarna";
             return selectAnswer({ answers: ["Saya belum tahu warna favorit Anda. Apa warna kesukaan Anda?"] });
         }
    },
    simpanWarnaFavorit: (message) => {
         const colorKeywords = ["warna favoritku", "warna kesukaanku", "aku suka warna", "saya suka warna"];
         let extractedColor = message.toLowerCase();
         for (const kw of colorKeywords) {
             if (extractedColor.startsWith(kw)) {
                 extractedColor = extractedColor.substring(kw.length).trim();
                 break;
             }
         }
         // Ambil sisa string sebagai warna
         if (extractedColor) {
              userPreferences.favColor = extractedColor;
              return selectAnswer({ answers: [`Oke, ${extractedColor} ya? Warna yang bagus! Sudah saya catat.`] });
         } else {
              currentContext = "menanyakanWarna";
              return selectAnswer({ answers: ["Hmm, warna apa ya? Bisa sebutkan lagi?"] });
         }
    },
    tambahPengingat: (message) => {
        const addKeywords = ["ingatkan saya", "buat pengingat", "tambah reminder", "catat", "tolong ingatkan", "set reminder"];
        let reminderText = message;
        for (const kw of addKeywords) {
             if (reminderText.toLowerCase().startsWith(kw)) {
                 reminderText = reminderText.substring(kw.length).trim();
                 break;
             }
        }
        if (reminderText) {
             reminders.push(reminderText);
             return selectAnswer({ answers: [`Baik, sudah saya catat: "${reminderText}". Katakan 'lihat pengingat' untuk cek.`] });
        } else {
             currentContext = "menungguDeskripsiPengingat";
             return selectAnswer({ answers: ["Oke, mau saya ingatkan tentang apa? Silakan ketik deskripsinya."] });
        }
    },
     simpanDeskripsiPengingat: (message) => {
         // Anggap pesan ini adalah deskripsi pengingatnya
         reminders.push(message);
         return selectAnswer({ answers: [`Siap, sudah dicatat: "${message}". Katakan 'lihat pengingat' untuk cek.`] });
     },
    tampilkanPengingat: () => {
        if (reminders.length === 0) {
             return selectAnswer({ answers: ["Saat ini tidak ada pengingat yang tersimpan."] });
        } else {
             const reminderList = reminders.map((r, index) => `${index + 1}. ${r}`).join('\n');
             return selectAnswer({ answers: [`Berikut daftar pengingat Anda:\n${reminderList}\n\nKatakan 'hapus pengingat' untuk membersihkan.`] });
        }
    },
    hapusSemuaPengingat: () => {
         if (reminders.length === 0) {
             return selectAnswer({ answers: ["Tidak ada pengingat yang perlu dihapus."] });
         } else {
             const count = reminders.length;
             reminders = [];
             return selectAnswer({ answers: [`Siap, ${count} pengingat telah berhasil dihapus.`] });
         }
    },
    ulangiJawabanTerakhir: () => {
        if (lastBotReply) {
            return selectAnswer({ answers: [`Tentu, tadi saya bilang:\n"${lastBotReply}"`] });
        } else {
            return selectAnswer({ answers: ["Maaf, belum ada percakapan sebelumnya untuk diulangi."] });
        }
    },
     mulaiKuis: () => {
         quizState = { currentQuestion: 0, score: 0, questions: kuisTrivia };
         const q = quizState.questions[0];
         currentContext = "kuis_berjalan"; // Set konteks kuis
         return selectAnswer({ answers: [`Oke, mari kita mulai kuis trivia sederhana! Pertanyaan pertama:\n${q.q}\nPilihan: ${q.o.join(', ')}`] });
     },
     prosesJawabanKuis: (message) => {
         if (!quizState || currentContext !== "kuis_berjalan") {
             return selectAnswer({ answers: ["Hmm, sepertinya kita tidak sedang dalam kuis?"] });
         }
         const qIndex = quizState.currentQuestion;
         const correctAnswer = quizState.questions[qIndex].a.toLowerCase();
         const userAnswer = message.toLowerCase().replace("jawabannya", "").replace("jawaban", "").replace("pilih", "").replace("opsi","").replace("itu","").replace("yang","").trim();

         let replyText = "";
         if (userAnswer.includes(correctAnswer)) {
             replyText = "Benar! ";
             quizState.score++;
         } else {
             replyText = `Salah. Jawaban yang benar adalah ${correctAnswer}. `;
         }

         quizState.currentQuestion++;
         if (quizState.currentQuestion < quizState.questions.length) {
             const nextQ = quizState.questions[quizState.currentQuestion];
             replyText += `\nPertanyaan berikutnya:\n${nextQ.q}\nPilihan: ${nextQ.o.join(', ')}`;
             // Konteks tetap 'kuis_berjalan'
         } else {
             // Kuis selesai
             const finalScore = quizState.score;
             const totalQuestions = quizState.questions.length;
             replyText += `\nKuis selesai! Skor Anda: ${finalScore} dari ${totalQuestions}.`;
             quizState = null; // Reset state kuis
             currentContext = null; // Hapus konteks kuis
         }
         return selectAnswer({ answers: [replyText] });
     },
     mulaiTsInternet: () => {
         troubleshootingState = { flow: 'internet', step: 1, history: [] };
         currentContext = 'ts_internet';
         return selectAnswer({ answers: ["Oke, mari coba perbaiki masalah internet. Pertama, apakah lampu indikator modem/router Anda menyala normal (biasanya hijau stabil)? (Jawab ya/tidak/tidak tahu)"] });
     },
     prosesTsInternet: (message) => {
          if (!troubleshootingState || troubleshootingState.flow !== 'internet' || currentContext !== 'ts_internet') {
             return selectAnswer({ answers: ["Hmm, sepertinya kita tidak sedang dalam proses troubleshooting internet?"] });
         }
         const answer = message.toLowerCase();
         const step = troubleshootingState.step;
         let nextReply = "Maaf, saya kehabisan ide. Mungkin coba hubungi ISP Anda?"; // Default fallback
         troubleshootingState.history.push({ step: step, answer: answer });

         if (step === 1) { // Setelah cek lampu modem
             if (answer.includes("tidak") || answer.includes("mati") || answer.includes("merah")) {
                 nextReply = "Coba periksa sambungan kabel power modem dan pastikan adaptornya terhubung dengan baik. Jika sudah, coba nyalakan lagi. Apakah sekarang lampunya normal? (ya/tidak)";
                 troubleshootingState.step = 1.1; // Sub-step
             } else if (answer.includes("ya") || answer.includes("normal") || answer.includes("hijau")) {
                 nextReply = "Bagus. Langkah kedua, coba restart modem/router Anda. Matikan selama sekitar 30 detik, lalu nyalakan kembali. Tunggu beberapa menit. Apakah internet sudah bisa? (ya/tidak)";
                 troubleshootingState.step = 2;
             } else { // tidak tahu / jawaban lain
                 nextReply = "Oke, mari lewati langkah lampu. Coba restart modem/router Anda. Matikan 30 detik, nyalakan lagi, tunggu beberapa menit. Apakah internet sudah bisa? (ya/tidak)";
                 troubleshootingState.step = 2;
             }
         } else if (step === 1.1) { // Setelah cek power
              if (answer.includes("ya") || answer.includes("normal")) {
                 nextReply = "Syukurlah. Sekarang, coba restart modem/router Anda (matikan 30 detik, nyalakan lagi). Tunggu beberapa menit. Apakah internet sudah bisa? (ya/tidak)";
                 troubleshootingState.step = 2;
             } else {
                  nextReply = "Hmm, jika lampu power masih bermasalah, kemungkinan ada masalah dengan perangkat atau adaptornya. Sebaiknya hubungi ISP atau teknisi. Proses troubleshooting selesai.";
                  troubleshootingState = null; currentContext = null;
             }
         } else if (step === 2) { // Setelah restart modem
             if (answer.includes("ya") || answer.includes("bisa")) {
                 nextReply = "Alhamdulillah! Senang masalahnya teratasi. Restart memang seringkali solusi jitu. Ada lagi?";
                 troubleshootingState = null; currentContext = null;
             } else {
                 nextReply = "Oke, langkah ketiga. Coba cek perangkat lain (HP/laptop lain) apakah bisa konek ke WiFi yang sama? (ya/tidak)";
                 troubleshootingState.step = 3;
             }
         } else if (step === 3) { // Setelah cek perangkat lain
             if (answer.includes("tidak") || answer.includes("sama saja")) { // Jika perangkat lain juga tidak bisa
                 nextReply = "Ini kemungkinan besar masalah ada pada jaringan ISP atau modem Anda. Sebaiknya hubungi Customer Service ISP Anda untuk pengecekan lebih lanjut. Proses troubleshooting selesai.";
                 troubleshootingState = null; currentContext = null;
             } else { // Jika perangkat lain bisa
                 nextReply = "Berarti masalah kemungkinan ada di perangkat Anda yang pertama tadi. Coba restart perangkat tersebut, atau cek pengaturan jaringannya (lupakan jaringan WiFi lalu sambungkan ulang). Proses troubleshooting selesai.";
                 troubleshootingState = null; currentContext = null;
             }
         }

         return selectAnswer({ answers: [nextReply] });
     },
     lemparDadu: () => {
         const hasil = Math.floor(Math.random() * 6) + 1;
         return selectAnswer({ answers: [`Saya lempar dadu (D6)... Hasilnya adalah: ${hasil}!`] });
     },
     lemparKoin: () => {
          const hasil = Math.random() < 0.5 ? "Gambar (Heads)" : "Angka (Tails)";
          return selectAnswer({ answers: [`Saya lempar koin... Hasilnya adalah: ${hasil}!`] });
     }
};

// --- Rute Utama Chatbot ---
app.get('/chat', (req, res) => {
    const userMessage = req.query.message;

    if (!userMessage || typeof userMessage !== 'string' || userMessage.trim() === '') {
        return res.status(400).json({ error: 'Parameter "message" diperlukan dan tidak boleh kosong.' });
    }

    // Update mood bot sesekali
    if (Math.random() < 0.15) { // 15% chance per request untuk update mood
        updateBotMood();
    }

    const normalizedMessage = userMessage.toLowerCase().trim();
    let reply = null;
    let matchedRule = null;
    let matchType = 'none';
    let fuseMatchDetails = null;
    const contextBeforeMatch = currentContext;

    console.log(`\n--- Request Baru (${new Date().toISOString()}) ---`);
    console.log(`Pesan: "${userMessage}" (Normalized: "${normalizedMessage}")`);
    console.log(`State Awal: Konteks=${contextBeforeMatch}, Nama=${userName}, Warna=${userPreferences.favColor}, Pengingat=${reminders.length}, Mood=${currentBotMood}, Rule Terakhir=${lastMatchedRuleId}`);
    console.log(`Quiz State: ${JSON.stringify(quizState)}, TS State: ${JSON.stringify(troubleshootingState)}`);


    // --- Deteksi Pengulangan ---
    const isRepeating = lastUserMessage && normalizedMessage === lastUserMessage.toLowerCase().trim() && lastMatchedRuleId && lastMatchedRuleId !== 'fallback';
    if (isRepeating) {
        console.log(`Deteksi Pengulangan untuk Rule ID: ${lastMatchedRuleId}`);
        matchType = 'repeat';
        const repeatAnswers = ["Seperti yang baru saja saya katakan: ", "Oke, saya ulangi lagi ya: ", "Intinya sama seperti tadi: "];
        reply = `${getRandomElement(repeatAnswers)}${lastBotReply || 'tidak ada jawaban spesifik.'}`;
        // Tidak perlu cari match lagi jika repeat
    }

    // --- Proses Pencocokan Aturan (Hanya jika bukan pengulangan) ---
    if (matchType !== 'repeat') {
        let bestMatch = null;

        // Cari kandidat match (Exact & Fuse) yang valid konteksnya
        const validMatches = [];

        // 1. Cari Exact Match Candidates
        for (const rule of sortedChatData) {
            const matchingKeywords = rule.keywords
                .filter(kw => normalizedMessage.includes(kw.toLowerCase()))
                .sort((a, b) => b.length - a.length);

            if (matchingKeywords.length > 0) {
                const contextIsValid = !rule.requiredContext || rule.requiredContext === contextBeforeMatch || rule.canInterruptContext;
                if (contextIsValid) {
                     validMatches.push({ rule, matchedKeyword: matchingKeywords[0], type: 'exact', priority: rule.priority, matchQuality: matchingKeywords[0].length }); // Match quality based on length
                } else {
                     console.log(`[Debug] Exact Match Rule '${rule.id}' dilewati karena konteks.`);
                }
            }
        }
        
        // 2. Cari Fuse Match Candidates
        const fuseResult = fuse.search(normalizedMessage);
        if (fuseResult.length > 0) {
            const validFuseMatches = fuseResult
                .filter(r => r.score <= fuseOptions.threshold)
                .map(r => ({ ...r, rule: sortedChatData.find(rule => rule.id === r.item.id) }))
                .filter(r => r.rule && (!r.rule.requiredContext || r.rule.requiredContext === contextBeforeMatch || r.rule.canInterruptContext));

             validFuseMatches.forEach(match => {
                 validMatches.push({ rule: match.rule, type: 'fuse', score: match.score, correctedKeyword: match.item.keyword, priority: match.rule.priority, matchQuality: 1 - match.score }); // Match quality based on score
             });
        }

        // 3. Pilih Match Terbaik dari semua kandidat valid
        if (validMatches.length > 0) {
             validMatches.sort((a, b) => {
                 // Prioritas utama
                 if (b.priority !== a.priority) return b.priority - a.priority;
                 // Jika prioritas sama, utamakan Exact
                 if (a.type === 'exact' && b.type !== 'exact') return -1;
                 if (b.type === 'exact' && a.type !== 'exact') return 1;
                 // Jika tipe sama (atau sama2 fuse), gunakan matchQuality
                 return b.matchQuality - a.matchQuality;
             });
             bestMatch = validMatches[0]; // Ambil yang terbaik
             matchedRule = bestMatch.rule;
             matchType = bestMatch.type;

             if (matchType === 'exact') {
                 console.log(`Match Terbaik: EXACT | Rule ID '${matchedRule.id}', Keyword '${bestMatch.matchedKeyword}', Prioritas ${matchedRule.priority}`);
             } else { // Fuse
                 fuseMatchDetails = { corrected: bestMatch.correctedKeyword, score: bestMatch.score };
                 console.log(`Match Terbaik: FUSE | Rule ID '${matchedRule.id}', Koreksi '${fuseMatchDetails.corrected}', Skor ${fuseMatchDetails.score.toFixed(3)}, Prioritas ${matchedRule.priority}`);
             }
        }


        // 4. Gunakan Fallback jika tidak ada match valid sama sekali
        if (!bestMatch) {
            matchedRule = sortedChatData.find(rule => rule.id === 'fallback');
            if (matchedRule) {
                 matchType = 'fallback';
                 console.log("Tidak ada match valid, menggunakan Fallback Rule.");
            } else {
                reply = "Maaf, terjadi error internal (Fallback rule tidak ditemukan).";
                 console.error("FATAL: Rule 'fallback' tidak ditemukan di chatData.json!");
                 matchType = 'error';
                 currentContext = null; // Reset konteks jika error fatal
            }
        }
        
        // --- Hasilkan Jawaban (jika bukan error) ---
        if (matchedRule && matchType !== 'error') {
            if (matchedRule.dynamicAnswer && dynamicAnswerFunctions[matchedRule.dynamicAnswer]) {
                try {
                    const dynamicFunc = dynamicAnswerFunctions[matchedRule.dynamicAnswer];
                    // Panggil fungsi dynamic, kirim 'userMessage' asli jika fungsi membutuhkannya
                    reply = dynamicFunc.length > 0 ? dynamicFunc(userMessage) : dynamicFunc();
                    console.log(`[OK] Dynamic Answer dari '${matchedRule.dynamicAnswer}' (Rule '${matchedRule.id}')`);
                } catch (error) {
                    console.error(`[ERROR] Dynamic Answer '${matchedRule.dynamicAnswer}' (Rule '${matchedRule.id}'):`, error);
                    reply = selectAnswer({ answers: ["Maaf, ada sedikit gangguan saat memproses jawaban itu."] }); // Gunakan selectAnswer untuk fallback
                }
            } else {
                // Gunakan fungsi selectAnswer untuk jawaban statis agar bisa dipersonalisasi/dimood
                reply = selectAnswer(matchedRule);
                 console.log(`[OK] Static Answer dipilih (Rule '${matchedRule.id}')`);
            }

            // --- Manajemen Konteks Pasca-Match ---
            // Konteks mungkin sudah diubah oleh dynamic function, cek lagi
            const contextAfterDynamic = currentContext;
            const contextExplicitlyCleared = matchedRule.clearContext === true;
            const contextExplicitlySet = matchedRule.setContext;
            const canInterrupt = matchedRule.canInterruptContext === true;
            const requiredContextOnRule = matchedRule.requiredContext;

            console.log(`[Context Check] Before: ${contextBeforeMatch}, AfterDynamic: ${contextAfterDynamic}, Explicit Set: ${contextExplicitlySet}, Explicit Clear: ${contextExplicitlyCleared}, Interrupt: ${canInterrupt}, Required: ${requiredContextOnRule}`);

            if (contextExplicitlyCleared) {
                 if(currentContext !== null) {
                    console.log(`[Context] Dihapus secara eksplisit oleh Rule '${matchedRule.id}'.`);
                    currentContext = null;
                 }
            } else if (contextExplicitlySet && contextAfterDynamic !== contextExplicitlySet) {
                // Hanya set jika dynamic function belum set ke nilai yg sama
                console.log(`[Context] Diatur ke '${contextExplicitlySet}' oleh Rule '${matchedRule.id}'.`);
                currentContext = contextExplicitlySet;
            } else if (!contextExplicitlySet) { // Jika tidak ada set eksplisit DARI RULE ini
                // Cek apakah rule ini 'membutuhkan' konteks yg aktif sblmnya ATAU bisa interupsi
                const neededPreviousContext = requiredContextOnRule === contextBeforeMatch;
                 if (!neededPreviousContext && !canInterrupt && contextBeforeMatch !== null && matchType !== 'fallback') {
                     // Jika rule ini TIDAK butuh konteks sebelumnya, TIDAK bisa interupsi,
                     // DAN konteks sebelumnya ADA (dan bukan hasil fallback), maka anggap topik beralih.
                     if (contextAfterDynamic === contextBeforeMatch) { // Hanya clear jika dynamic func tidak mengubahnya
                          console.log(`[Context] Dihapus karena Rule '${matchedRule.id}' tidak relevan/interupsi thd '${contextBeforeMatch}'.`);
                          currentContext = null;
                     }
                 } else if (contextBeforeMatch !== null && contextAfterDynamic === null) {
                      // Jika konteks sebelumnya ada, tapi dynamic func menghapusnya, biarkan saja.
                      // Jika konteks sblmnya ada, dan dynamic func TIDAK menghapusnya, pertahankan.
                      currentContext = contextBeforeMatch;
                       console.log(`[Context] Dipertahankan ('${contextBeforeMatch}') untuk Rule '${matchedRule.id}'.`);
                 } else if (contextBeforeMatch !== null && contextAfterDynamic !== null) {
                     // Jika dynamic function MENGUBAH konteks, gunakan konteks dari dynamic func
                     currentContext = contextAfterDynamic;
                      console.log(`[Context] Dipertahankan ('${currentContext}') dari dynamic func.`);
                 }
            }
            
            // Simpan ID rule yang cocok untuk deteksi pengulangan
            lastMatchedRuleId = matchedRule.id;
        } // end if(matchedRule && matchType !== 'error')

    } // end if(matchType !== 'repeat')

    // Simpan pesan & jawaban terakhir
    lastUserMessage = userMessage;
    lastBotReply = reply; // Simpan jawaban bot untuk fitur 'ulangi'

     // --- Kirim Respons ---
     const finalReply = reply || "Maaf, saya tidak dapat memberikan jawaban saat ini.";
     console.log(`Jawaban: "${finalReply.substring(0, 150)}..."`);
     console.log(`State Akhir: Konteks=${currentContext}, Nama=${userName}, Warna=${userPreferences.favColor}, Pengingat=${reminders.length}, Mood=${currentBotMood}, Rule Cocok=${lastMatchedRuleId}`);
     console.log(`Match Type: ${matchType}`);
     console.log(`--- Akhir Request ---`);

     res.json({
         query: userMessage,
         reply: finalReply,
         match_details: {
             type: matchType,
             rule_id: lastMatchedRuleId,
             priority: matchedRule ? matchedRule.priority : null,
             context_before: contextBeforeMatch,
             context_after: currentContext,
             bot_mood: currentBotMood, // Kirim info mood bot
             user_name: userName,
             user_fav_color: userPreferences.favColor,
             reminder_count: reminders.length,
             quiz_active: !!quizState, // Kirim status kuis
             troubleshooting_active: !!troubleshootingState, // Kirim status TS
             fuse_info: matchType === 'fuse' ? fuseMatchDetails : null
         }
     });
});

// Rute default untuk cek server
app.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(`
        <h1>Server Chatbot Express.js (v5) Aktif!</h1>
        <p>Gunakan endpoint <code>/chat?message=pesan_anda</code> untuk berinteraksi.</p>
        <p><strong>Fitur Baru:</strong> Kuis, Troubleshooting Internet Dasar, Preferensi Warna, Dadu/Koin, Mood Bot, dll.</p>
        <p>Contoh:</p>
        <ul>
            <li><a href="/chat?message=halo" target="_blank">/chat?message=halo</a></li>
            <li><a href="/chat?message=mulai%20kuis" target="_blank">/chat?message=mulai kuis</a></li>
            <li><a href="/chat?message=internet%20mati" target="_blank">/chat?message=internet mati</a></li>
            <li><a href="/chat?message=lempar%20dadu" target="_blank">/chat?message=lempar dadu</a></li>
            <li><a href="/chat?message=apa%20warna%20favoritku" target="_blank">/chat?message=apa warna favoritku</a></li>
            <li><a href="/chat?message=warna%20kesukaanku%20biru" target="_blank">/chat?message=warna kesukaanku biru</a> (Setelah ditanya warna)</li>
            <li><a href="/chat?message=ulangi" target="_blank">/chat?message=ulangi</a></li>
        </ul>
        <p><em>Waktu Server: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB</em> | Mood Bot: ${currentBotMood}</p>
    `);
});

// Middleware 404
app.use((req, res, next) => {
  res.status(404).json({ error: 'Endpoint tidak ditemukan. Gunakan /chat?message=...' });
});

// Middleware Error 500
app.use((err, req, res, next) => {
  console.error("================ SERVER ERROR ================");
  console.error(err.stack);
  console.error("============================================");
  res.status(500).json({ error: 'Terjadi kesalahan internal pada server.' });
});
// Thiết lập các hằng số
const BATCH_SIZE = 5;

// === Biến trạng thái toàn cục ===
let processingState = 'stopped'; // 'running', 'paused', 'stopped'
let allArticles = []; 
let allResults = []; 
let failedArticlesForDownload = [];
let currentArticleIndex = 0; 
let originalFileNameBase = ''; 
// ======================================

// Lấy các đối tượng DOM
const startButton = document.getElementById('startButton');
const pauseButton = document.getElementById('pauseButton');
const stopButton = document.getElementById('stopButton');
const settingsFieldset = document.getElementById('settings-fieldset');
const csvFileInput = document.getElementById('csvFile');
const statusText = document.querySelector('#status p');
const progressBar = document.getElementById('progressBar');
const statusSummary = document.getElementById('status-summary');
const successCountSpan = document.getElementById('successCount');
const failedCountSpan = document.getElementById('failedCount');

// MỚI: Thêm nút tải kết quả chính
const downloadResultsButton = document.getElementById('downloadResultsButton');
const downloadErrorsButton = document.getElementById('downloadErrorsButton');
const batchResultsContainer = document.getElementById('batch-results-container');
const batchResultsHead = document.getElementById('batch-results-head');
const batchResultsBody = document.getElementById('batch-results-body');

// Gắn sự kiện click
startButton.addEventListener('click', handleStartResume);
pauseButton.addEventListener('click', handlePause);
stopButton.addEventListener('click', handleStop);

// MỚI: Thêm sự kiện click cho nút tải kết quả
downloadResultsButton.addEventListener('click', handleDownloadResults);
downloadErrorsButton.addEventListener('click', handleDownloadErrors);

/**
 * MỚI: Hàm xử lý tải về tệp CSV kết quả chính
 */
function handleDownloadResults() {
    if (allResults.length === 0) {
        alert("Không có kết quả nào để tải về.");
        return;
    }
    updateStatus(`Đang tạo tệp CSV cho ${allResults.length} kết quả...`);
    
    // Sử dụng tên tệp động
    const resultsFilename = `${originalFileNameBase}_results_partial.csv`;
    generateOutputCSV(allResults, resultsFilename);
}

/**
 * Xử lý khi nhấn nút "Bắt đầu" hoặc "Tiếp tục"
 */
function handleStartResume() {
    if (processingState === 'stopped') {
        startNewProcess();
    } else if (processingState === 'paused') {
        processingState = 'running';
        updateButtonUI('running');
        updateStatus('Đang tiếp tục xử lý...');
    }
}

/**
 * Xử lý khi nhấn "Tạm dừng"
 */
function handlePause() {
    if (processingState === 'running') {
        processingState = 'paused';
        updateButtonUI('paused');
    }
}

/**
 * Xử lý khi nhấn "Dừng hẳn"
 */
function handleStop() {
    if (processingState === 'running' || processingState === 'paused') {
        processingState = 'stopped';
        updateButtonUI('stopped');
        updateStatus('Đã nhận lệnh dừng... Sẽ hoàn tất batch hiện tại (nếu có) và xuất file.');
    }
}

/**
 * Xóa/ẩn bảng kết quả batch
 */
function clearBatchResults() {
    batchResultsContainer.classList.add('hidden');
    batchResultsHead.innerHTML = ''; 
    batchResultsBody.innerHTML = '';
}

/**
 * Hiển thị kết quả của một batch (Đã tối ưu hóa)
 */
function displayBatchResults(batchData) {
    if (!batchData || batchData.length === 0) return;

    // 1. Xóa nội dung cũ
    batchResultsHead.innerHTML = '';
    batchResultsBody.innerHTML = '';

    // Chỉ định các cột chúng ta muốn hiển thị
    const headersToShow = [
        'Title', 
        'Abstract', 
        'Input_Data', 
        'Mechanism', 
        'Output_Result', 
        'Accuracy', 
        'Num_Classes', 
        'Resolution'
    ];

    // 2. Tạo Header (dựa trên danh sách headersToShow)
    const headerRow = document.createElement('tr');
    headersToShow.forEach(header => {
        if (batchData[0].hasOwnProperty(header)) {
            const th = document.createElement('th');
            th.textContent = header;
            if (header === 'Abstract') {
                th.classList.add('abstract-col');
            }
            headerRow.appendChild(th);
        }
    });
    batchResultsHead.appendChild(headerRow);

    // 3. Tạo Body
    batchData.forEach(article => {
        const row = document.createElement('tr');
        
        if (article.Mechanism === 'LỖI' || (article.Input_Data && article.Input_Data.startsWith('LỖI:'))) {
            row.classList.add('error-row');
        }

        headersToShow.forEach(header => {
            if (batchData[0].hasOwnProperty(header)) {
                const td = document.createElement('td');
                td.textContent = article[header] || '';
                if (header === 'Abstract') {
                    td.classList.add('abstract-col');
                }
                row.appendChild(td);
            }
        });
        batchResultsBody.appendChild(row);
    });

    // 4. Hiển thị container
    batchResultsContainer.classList.remove('hidden');
}


/**
 * Hàm chính bắt đầu một quy trình MỚI
 */
async function startNewProcess() {
    // 1. Lấy cài đặt
    const apiKey = document.getElementById('apiKey').value;
    const modelName = document.getElementById('modelName').value;
    const delayTimeS = parseInt(document.getElementById('delayTime').value, 10);
    const delayTimeMs = delayTimeS * 1000;
    const csvFile = csvFileInput.files[0];

    // 2. Kiểm tra đầu vào
    if (!csvFile) { 
        alert('Vui lòng chọn tệp CSV.');
        return;
    }
    if (!apiKey || !modelName || !delayTimeS) {
        alert('Vui lòng điền đầy đủ API Key, Tên Model và Thời gian nghỉ.');
        return;
    }

    // 3. Đặt lại trạng thái và UI
    disableSettings(true); 
    updateButtonUI('running');
    statusSummary.classList.add('hidden');
    downloadErrorsButton.classList.add('hidden');
    downloadResultsButton.classList.add('hidden'); // MỚI: Ẩn nút tải kết quả
    clearBatchResults(); 
    progressBar.value = 0;

    // 4. Đặt lại các biến toàn cục
    allArticles = [];
    allResults = [];
    failedArticlesForDownload = [];
    currentArticleIndex = 0;
    
    // Lấy và lưu tên tệp gốc
    const originalFileName = csvFile.name;
    originalFileNameBase = originalFileName.replace(/\.csv$/i, ''); 
    
    try {
        // 5. Parse CSV
        updateStatus('Đang đọc tệp CSV...');
        allArticles = await parseCSV(csvFile);
        if (!allArticles || allArticles.length === 0) {
            throw new Error("Không thể đọc CSV hoặc CSV rỗng.");
        }
        if (!allArticles[0].hasOwnProperty('Title') || !allArticles[0].hasOwnProperty('Abstract') || !allArticles[0].hasOwnProperty('Year')) {
            throw new Error("Tệp CSV phải chứa các cột 'Title', 'Abstract', và 'Year'.");
        }
        updateStatus(`Tìm thấy ${allArticles.length} bài báo. Bắt đầu xử lý...`);
        
        // 6. Chạy vòng lặp xử lý
        processingState = 'running';
        await processBatches(apiKey, modelName, delayTimeMs);

    } catch (error) {
        console.error('Lỗi nghiêm trọng:', error);
        updateStatus(`Lỗi: ${error.message}`);
    } finally {
        // 7. Hoàn tất
        processingState = 'stopped';
        generateFinalReport(); // THAY ĐỔI: Hàm này giờ chỉ hiển thị báo cáo
        disableSettings(false); 
        updateButtonUI('stopped');
    }
}

/**
 * Vòng lặp chính xử lý các batch
 */
async function processBatches(apiKey, modelName, delayTimeMs) {
    const totalArticles = allArticles.length;

    for (/* bắt đầu từ index hiện tại */; currentArticleIndex < totalArticles; currentArticleIndex += BATCH_SIZE) {
        
        // --- ĐIỂM KIỂM SOÁT ---
        while (processingState === 'paused') {
            updateStatus(`Đã tạm dừng ở bài ${currentArticleIndex + 1}. Nhấn "Tiếp tục" để chạy.`);
            await new Promise(resolve => setTimeout(resolve, 500)); 
        }
        if (processingState === 'stopped') {
            updateStatus('Đã dừng. Đang chuẩn bị xuất kết quả...');
            break; 
        }
        // --- KẾT THÚC ĐIỂM KIỂM SOÁT ---

        const batch = allArticles.slice(currentArticleIndex, currentArticleIndex + BATCH_SIZE);
        const batchNumber = (currentArticleIndex / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(totalArticles / BATCH_SIZE);

        updateStatus(`Đang xử lý batch ${Math.floor(batchNumber)} / ${totalBatches} (Bài báo ${currentArticleIndex + 1} đến ${Math.min(currentArticleIndex + BATCH_SIZE, totalArticles)})...`);
        
        const batchPromises = batch.map(article => callGeminiAPI(article, apiKey, modelName));
        const settledResults = await Promise.allSettled(batchPromises);

        const currentBatchDisplayResults = [];

        // Thu thập kết quả
        settledResults.forEach((result, index) => {
            const originalArticle = batch[index];
            let articleResult; 

            if (result.status === 'fulfilled') {
                articleResult = result.value;
                allResults.push(articleResult);
            } else {
                console.error(`Lỗi xử lý "${originalArticle.Title}":`, result.reason);
                failedArticlesForDownload.push(originalArticle);
                
                const errorMsg = result.reason.message.toLowerCase();
                if (errorMsg.includes('quota') || errorMsg.includes('limit') || result.reason.message.includes('429')) {
                    console.warn('Phát hiện lỗi quota. Tự động dừng...');
                    processingState = 'stopped';
                }

                articleResult = { ...originalArticle }; 
                articleResult.Input_Data = `LỖI: ${result.reason.message}`;
                articleResult.Mechanism = 'LỖI';
                // ... (thêm các trường lỗi khác)
                allResults.push(articleResult);
            }
            
            currentBatchDisplayResults.push(articleResult);
        });

        // Hiển thị kết quả batch
        displayBatchResults(currentBatchDisplayResults);

        // Cập nhật thanh tiến trình
        updateProgress(allResults.length, totalArticles);

        // Nghỉ
        if (currentArticleIndex + BATCH_SIZE < totalArticles && processingState === 'running') {
            updateStatus(`Đã xử lý xong batch ${Math.floor(batchNumber)}. Đang nghỉ ${delayTimeMs / 1000} giây... (Kết quả bên dưới)`);
            await new Promise(resolve => setTimeout(resolve, delayTimeMs));
        }
    }
}

/**
 * THAY ĐỔI: Hàm này giờ chỉ tạo báo cáo tóm tắt và hiển thị các nút tải
 */
function generateFinalReport() {
    if (allResults.length === 0 && failedArticlesForDownload.length === 0) {
        updateStatus("Đã dừng trước khi xử lý. Không có kết quả để xuất.");
        return;
    }
    
    // THAY ĐỔI: Đã XÓA lệnh gọi generateOutputCSV() tự động
    
    const failedCount = failedArticlesForDownload.length;
    const successCount = allResults.length - failedCount;
    
    successCountSpan.textContent = successCount;
    failedCountSpan.textContent = failedCount;
    statusSummary.classList.remove('hidden');

    let finalMessage = `Hoàn thành! Thành công: ${successCount}, Thất bại: ${failedCount}.`;
    
    // MỚI: Hiển thị nút tải kết quả chính nếu có kết quả
    if (allResults.length > 0) {
        downloadResultsButton.classList.remove('hidden');
        finalMessage += " Bạn có thể tải về tệp kết quả.";
    }

    // Hiển thị nút tải lỗi nếu có lỗi
    if (failedCount > 0) {
        downloadErrorsButton.classList.remove('hidden');
        finalMessage += " Bạn có thể tải về danh sách bài lỗi.";
    }
    
    if (processingState === 'stopped' && currentArticleIndex < allArticles.length - 1) {
         finalMessage = `Đã dừng. ${allResults.length} kết quả đã xử lý. (Thành công: ${successCount}, Thất bại: ${failedCount})`;
    }
    
    updateStatus(finalMessage);
}


/**
 * Cập nhật UI của các nút điều khiển
 */
function updateButtonUI(state) { 
    if (state === 'running') {
        startButton.classList.add('hidden');
        pauseButton.classList.remove('hidden');
        stopButton.classList.remove('hidden');
    } else if (state === 'paused') {
        startButton.textContent = 'Tiếp tục Xử lý'; 
        startButton.classList.remove('hidden');
        pauseButton.classList.add('hidden');
        stopButton.classList.remove('hidden');
    } else { // 'stopped'
        startButton.textContent = 'Bắt đầu Xử lý';
        startButton.classList.remove('hidden');
        pauseButton.classList.add('hidden');
        stopButton.classList.add('hidden');
    }
}

/**
 * Vô hiệu hóa/Kích hoạt các ô cài đặt
 */
function disableSettings(disabled) {
    settingsFieldset.disabled = disabled;
}

// ==========================================================
// CÁC HÀM TIỆN ÍCH (Giữ nguyên)
// ==========================================================

function handleDownloadErrors() {
    if (failedArticlesForDownload.length === 0) {
        alert("Không có bài báo lỗi nào để tải về.");
        return;
    }
    updateStatus(`Đang tạo tệp CSV cho ${failedArticlesForDownload.length} bài báo lỗi...`);
    
    const errorFilename = `${originalFileNameBase}_failed_retry.csv`;
    generateOutputCSV(failedArticlesForDownload, errorFilename);
}

function updateStatus(message) {
    statusText.textContent = `Trạng thái: ${message}`;
    console.log(message);
}

function updateProgress(processedCount, totalCount) {
    const percentage = (processedCount / totalCount) * 100;
    progressBar.value = percentage;
}

function parseCSV(file) {
    return new Promise((resolve, reject) => {
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                resolve(results.data);
            },
            error: (error) => {
                reject(error);
            }
        });
    });
}

function buildPrompt(article) {
    // (Hàm này không thay đổi)
    return `
    Phân tích bài báo khoa học sau đây về chủ đề Land Use Land Cover (LULC).
    Chỉ tập trung vào thông tin từ Title, Year, và Abstract được cung cấp.
    
    Thông tin bài báo:
    - Year: ${article.Year}
    - Title: ${article.Title}
    - Abstract: ${article.Abstract}
    
    Nhiệm vụ: Trích xuất các thông tin sau và trả về DUY NHẤT một đối tượng JSON.
    Không thêm bất kỳ văn bản giải thích nào trước hoặc sau JSON.
    
    1.  **input_data**: (string) Loại dữ liệu đầu vào chính. Ví dụ: "Ảnh Landsat 8", "Ảnh Sentinel-2 và dữ liệu vector", "Dữ liệu đa phổ".
    2.  **mechanism**: (string) Phương pháp chính được sử dụng. Ví dụ: "Random Forest (RF)", "Convolutional Neural Network (CNN)", "Support Vector Machine (SVM)", "Object-Based Image Analysis (OBIA)".
    3.  **output_result**: (string) Kết quả chính hoặc sản phẩm của nghiên cứu. Ví dụ: "Bản đồ LULC", "Phân tích biến động LULC", "Mô hình dự đoán thay đổi".
    4.  **accuracy**: (string) Độ chính xác tổng thể (Overall Accuracy) nếu được đề cập trong abstract. Nếu không, điền "N/A". Ví dụ: "92.5%", "N/A".
    5.  **num_classes**: (string) Số lượng lớp LULC nếu được đề cập. Nếu không, điền "N/A". Ví dụ: "6 lớp", "N/A".
    6.  **resolution**: (string) Độ phân giải của dữ liệu nếu được đề cập. Nếu không, điền "N/A". Ví dụ: "30m", "10m", "N/A".
    7.  **time_frame**: (string) Khoảng thời gian của dữ liệu nếu được đề cập. Nếu không, điền "N/A". Ví dụ: "2010-2020", "N/A".
    
    Chỉ trả về đối tượng JSON chứa nội dung bằng tiếng Anh (English) theo định dạng sau:
    {
      "input_data": "...",
      "mechanism": "...",
      "output_result": "...",
      "accuracy": "...",
      "num_classes": "...",
      "resolution": "...",
      "time_frame": "..."
    }
    `;
}

async function callGeminiAPI(article, apiKey, modelName) {
    // (Hàm này không thay đổi)
    const prompt = buildPrompt(article);
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

    const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            safetySettings: [
                { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
            ],
            generationConfig: {
                responseMimeType: "application/json",
                temperature: 0.1
            }
        })
    });

    if (!response.ok) {
        const errorBody = await response.json();
        console.error("Lỗi API Gemini:", errorBody);
        if (response.status === 429) {
             throw new Error(`API Error 429: Rate limit exceeded (Quota). ${errorBody.error.message}`);
        }
        throw new Error(`API Error: ${errorBody.error.message}`);
    }

    const data = await response.json();

    try {
        const jsonText = data.candidates[0].content.parts[0].text;
        const resultJson = JSON.parse(jsonText);

        const outputArticle = { ...article };
        outputArticle.Input_Data = resultJson.input_data || 'N/A';
        outputArticle.Mechanism = resultJson.mechanism || 'N/A';
        outputArticle.Output_Result = resultJson.output_result || 'N/A';
        outputArticle.Accuracy = resultJson.accuracy || 'N/A';
        outputArticle.Num_Classes = resultJson.num_classes || 'N/A';
        outputArticle.Resolution = resultJson.resolution || 'N/A';
        outputArticle.Time_Frame = resultJson.time_frame || 'N/A';
        
        return outputArticle;

    } catch (e) {
        console.error("Lỗi parse JSON từ Gemini:", e, "Response text:", data.candidates[0].content.parts[0].text);
        throw new Error("Gemini không trả về JSON hợp lệ.");
    }
}

function generateOutputCSV(results, filename = 'LULC_analysis_results.csv') {
    // (Hàm này không thay đổi)
    if (results.length === 0) {
        console.log("Không có kết quả nào để xuất cho:", filename);
        return;
    }
    
    const csvString = Papa.unparse(results);
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

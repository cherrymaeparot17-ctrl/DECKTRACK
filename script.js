
// ==========================================
// DECKTRACK - JAVASCRIPT
// ==========================================

// Open access: any non-empty CTU ID number can enter this local demo.

const $ = id => document.getElementById(id);

const today = () => {
    const d = new Date();
    return d.getFullYear() + "-" +
        String(d.getMonth() + 1).padStart(2, "0") + "-" +
        String(d.getDate()).padStart(2, "0");
};

const now = () => new Date().toLocaleString();

const escapeHTML = value => String(value ?? "").replace(
    /[&<>"']/g,
    char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[char]
);

const dateText = value => value
    ? new Date(value + "T00:00:00").toLocaleDateString()
    : "—";

// ==========================================
// DATA STORAGE
// ==========================================

const sampleEquipment = [
    {
        id: 1,
        name: "Digital Multimeter",
        barcode: "DT1001",
        category: "Measuring Tool",
        quantity: 5,
        available: 5
    },
    {
        id: 2,
        name: "Arduino Uno",
        barcode: "DT1002",
        category: "Microcontroller",
        quantity: 10,
        available: 10
    },
    {
        id: 3,
        name: "Oscilloscope",
        barcode: "DT1003",
        category: "Testing Equipment",
        quantity: 3,
        available: 3
    },
    {
        id: 4,
        name: "Soldering Iron",
        barcode: "DT1004",
        category: "Hand Tool",
        quantity: 8,
        available: 8
    },
    {
        id: 5,
        name: "Breadboard",
        barcode: "DT1005",
        category: "Circuit Component",
        quantity: 15,
        available: 15
    }
];

let equipment = JSON.parse(
    localStorage.getItem("deckEquipment") || "null"
) || sampleEquipment;

let transactions = JSON.parse(
    localStorage.getItem("deckTransactions") || "[]"
);

function saveData() {
    localStorage.setItem("deckEquipment", JSON.stringify(equipment));
    localStorage.setItem("deckTransactions", JSON.stringify(transactions));
}

function nextEquipmentId() {
    return Math.max(0, ...equipment.map(item => item.id)) + 1;
}

function nextTransactionId() {
    return Math.max(0, ...transactions.map(item => item.id)) + 1;
}

function isOverdue(transaction) {
    return transaction.status === "Borrowed" &&
        transaction.dueDate < today();
}

function transactionStatus(transaction) {
    if (transaction.status === "Returned") return "Returned";
    return isOverdue(transaction) ? "Overdue" : "Borrowed";
}

function statusBadge(status) {
    const cls = status.toLowerCase();
    return `<span class="badge ${cls}">${escapeHTML(status)}</span>`;
}

function emptyRow(columns, message = "No records found.") {
    return `<tr><td class="empty-row" colspan="${columns}">
        ${escapeHTML(message)}
    </td></tr>`;
}

// ==========================================
// LOGIN AND LOGOUT
// ==========================================

$("loginForm").addEventListener("submit", function(event) {
    event.preventDefault();

    const userId = $("userId").value.trim();

    if (userId) {
        sessionStorage.setItem("deckLoggedIn", "true");
        sessionStorage.setItem("deckUserId", userId);
        showApp();
    } else {
        $("loginError").textContent = "Please enter your CTU ID number.";
    }
});

function showApp() {
    $("loginPage").classList.add("hidden");
    $("mainApp").classList.remove("hidden");
    const userId = sessionStorage.getItem("deckUserId") || "CTU User";
    $("currentUserLabel").textContent = userId;
    $("currentUserAvatar").textContent = userId.charAt(0).toUpperCase();
    $("currentUserTopAvatar").textContent = userId.charAt(0).toUpperCase();
    $("currentDate").textContent = new Date().toLocaleDateString(
        undefined,
        { year: "numeric", month: "long", day: "numeric" }
    );
    renderAll();
}

$("logoutBtn").addEventListener("click", () => {
    sessionStorage.removeItem("deckLoggedIn");
    sessionStorage.removeItem("deckUserId");
    $("mainApp").classList.add("hidden");
    $("loginPage").classList.remove("hidden");
    $("loginForm").reset();
    $("loginError").textContent = "";
});

if (sessionStorage.getItem("deckLoggedIn") === "true") {
    showApp();
}

// ==========================================
// NAVIGATION
// ==========================================

const pageNames = {
    dashboard: "Dashboard",
    equipment: "Equipment Inventory",
    borrow: "Borrow Equipment",
    return: "Return Equipment",
    history: "Transaction History"
};

function openPage(pageId) {
    document.querySelectorAll(".page").forEach(page => {
        page.classList.remove("active-page");
    });

    document.querySelectorAll(".nav-link").forEach(link => {
        link.classList.remove("active");
    });

    $(pageId).classList.add("active-page");

    const nav = document.querySelector(
        `.nav-link[data-page="${pageId}"]`
    );

    if (nav) nav.classList.add("active");

    $("pageTitle").textContent = pageNames[pageId] || "DECKTRACK";
    renderAll();

    if (pageId === "borrow") {
        $("borrowBarcode").focus();
    }
}

document.querySelectorAll(".nav-link").forEach(button => {
    button.addEventListener("click", () => {
        openPage(button.dataset.page);
    });
});

document.querySelectorAll("[data-goto]").forEach(button => {
    button.addEventListener("click", () => {
        openPage(button.dataset.goto);
    });
});

$("borrowBarcode").addEventListener("keydown", event => {
    if (event.key === "Enter") {
        event.preventDefault();
        $("borrowForm").requestSubmit();
    }
});

// ==========================================
// DASHBOARD
// ==========================================

function renderDashboard() {
    const total = equipment.reduce((sum, item) =>
        sum + Number(item.quantity), 0
    );

    const available = equipment.reduce((sum, item) =>
        sum + Number(item.available), 0
    );

    const borrowed = transactions
        .filter(t => t.status === "Borrowed")
        .reduce((sum, t) => sum + Number(t.quantity), 0);

    const overdue = transactions
        .filter(isOverdue)
        .reduce((sum, t) => sum + Number(t.quantity), 0);

    $("totalEquipment").textContent = total;
    $("availableEquipment").textContent = available;
    $("borrowedEquipment").textContent = borrowed;
    $("overdueEquipment").textContent = overdue;

    const recent = [...transactions].reverse().slice(0, 5);

    $("recentTable").innerHTML = recent.length
        ? recent.map(t => `
            <tr>
                <td><strong>${escapeHTML(t.borrower)}</strong></td>
                <td>${escapeHTML(t.equipmentName)}</td>
                <td>${escapeHTML(t.barcode)}</td>
                <td>${escapeHTML(t.borrowedAt)}</td>
                <td>${statusBadge(transactionStatus(t))}</td>
            </tr>
        `).join("")
        : emptyRow(5, "No transactions yet.");
}

// ==========================================
// EQUIPMENT INVENTORY
// ==========================================

function renderEquipment() {
    const search = $("equipmentSearch").value.toLowerCase();

    const filtered = equipment.filter(item =>
        item.name.toLowerCase().includes(search) ||
        item.barcode.toLowerCase().includes(search) ||
        item.category.toLowerCase().includes(search)
    );

    $("equipmentCount").textContent =
        `${filtered.length} equipment type(s)`;

    $("equipmentTable").innerHTML = filtered.length
        ? filtered.map(item => `
            <tr>
                <td><strong>${escapeHTML(item.name)}</strong></td>
                <td>${escapeHTML(item.barcode)}</td>
                <td>${escapeHTML(item.category)}</td>
                <td>${item.quantity}</td>
                <td>${item.available}</td>
                <td>${statusBadge(
                    item.available > 0 ? "Available" : "Borrowed"
                )}</td>
                <td>
                    <button class="small-btn delete-btn"
                        data-delete="${item.id}">Delete</button>
                </td>
            </tr>
        `).join("")
        : emptyRow(7);
}

$("equipmentSearch").addEventListener("input", renderEquipment);

$("showAddForm").addEventListener("click", () => {
    $("addEquipmentPanel").classList.remove("hidden");
    $("eqName").focus();
});

$("cancelAdd").addEventListener("click", () => {
    $("addEquipmentPanel").classList.add("hidden");
    $("equipmentForm").reset();
});

$("equipmentForm").addEventListener("submit", event => {
    event.preventDefault();

    const name = $("eqName").value.trim();
    const barcode = $("eqBarcode").value.trim();
    const category = $("eqCategory").value.trim();
    const quantity = Number($("eqQuantity").value);

    if (equipment.some(item =>
        item.barcode.toLowerCase() === barcode.toLowerCase()
    )) {
        alert("This barcode is already registered.");
        return;
    }

    if (quantity < 1 || !Number.isInteger(quantity)) {
        alert("Enter a valid whole-number quantity.");
        return;
    }

    equipment.push({
        id: nextEquipmentId(),
        name,
        barcode,
        category,
        quantity,
        available: quantity
    });

    saveData();
    $("equipmentForm").reset();
    $("addEquipmentPanel").classList.add("hidden");
    renderAll();
    alert("Equipment added successfully!");
});

$("equipmentTable").addEventListener("click", event => {
    const button = event.target.closest("[data-delete]");
    if (!button) return;

    const id = Number(button.dataset.delete);
    const item = equipment.find(eq => eq.id === id);

    if (!item) return;

    const hasActiveBorrow = transactions.some(t =>
        t.barcode === item.barcode && t.status === "Borrowed"
    );

    if (hasActiveBorrow) {
        alert("This equipment has active borrowing records and cannot be deleted.");
        return;
    }

    if (!confirm(`Delete ${item.name} from the inventory?`)) return;

    equipment = equipment.filter(eq => eq.id !== id);
    saveData();
    renderAll();
});

// ==========================================
// BORROW EQUIPMENT
// ==========================================

function renderBorrowed() {
    const active = transactions.filter(t => t.status === "Borrowed");

    $("borrowedTable").innerHTML = active.length
        ? [...active].reverse().map(t => `
            <tr>
                <td><strong>${escapeHTML(t.borrower)}</strong></td>
                <td>${escapeHTML(t.equipmentName)}</td>
                <td>${escapeHTML(t.barcode)}</td>
                <td>${t.quantity}</td>
                <td>${dateText(t.dueDate)}</td>
                <td>${statusBadge(transactionStatus(t))}</td>
            </tr>
        `).join("")
        : emptyRow(6, "No equipment currently borrowed.");
}

function printBorrowReceipt(transaction) {
    $("printReceipt").innerHTML = `
        <header class="receipt-header">
            <h1>DECKTRACK</h1>
            <p>Computer Engineering Laboratory</p>
            <strong>EQUIPMENT BORROWING RECEIPT</strong>
        </header>
        <div class="receipt-row">
            <span>Receipt No.</span>
            <strong>DT-${String(transaction.id).padStart(5, "0")}</strong>
        </div>
        <div class="receipt-row">
            <span>Date / Time</span>
            <span>${escapeHTML(transaction.borrowedAt)}</span>
        </div>
        <hr>
        <div class="receipt-row">
            <span>Borrower</span>
            <strong>${escapeHTML(transaction.borrower)}</strong>
        </div>
        <div class="receipt-row">
            <span>ID Number</span>
            <span>${escapeHTML(transaction.borrowerId)}</span>
        </div>
        <div class="receipt-row">
            <span>Role</span>
            <span>${escapeHTML(transaction.role)}</span>
        </div>
        <hr>
        <p class="receipt-item-label">EQUIPMENT</p>
        <p class="receipt-item-name">${escapeHTML(transaction.equipmentName)}</p>
        <div class="receipt-row">
            <span>Barcode</span>
            <span>${escapeHTML(transaction.barcode)}</span>
        </div>
        <div class="receipt-row">
            <span>Quantity</span>
            <span>${transaction.quantity}</span>
        </div>
        <div class="receipt-row receipt-due">
            <strong>Return By</strong>
            <strong>${escapeHTML(dateText(transaction.dueDate))}</strong>
        </div>
        <p class="receipt-note">Please return the equipment on or before the due date. Keep this receipt for your records.</p>
        <div class="receipt-signature">Borrower's Signature</div>
        <footer>Thank you for taking care of our laboratory equipment.</footer>
    `;

    window.print();
}

let lastBorrowedTransaction = null;

$("borrowForm").addEventListener("submit", event => {
    event.preventDefault();
    lastBorrowedTransaction = null;
    $("printReceiptBtn").classList.add("hidden");

    const borrower = $("borrowerName").value.trim();
    const borrowerId = $("borrowerId").value.trim();
    const role = $("borrowerRole").value;
    const barcode = $("borrowBarcode").value.trim();
    const quantity = Number($("borrowQuantity").value);
    const dueDate = $("dueDate").value;

    const item = equipment.find(eq =>
        eq.barcode.toLowerCase() === barcode.toLowerCase()
    );

    const message = $("borrowMessage");
    message.className = "message";

    if (!item) {
        message.textContent = "Equipment barcode not found.";
        message.classList.add("error");
        return;
    }

    if (!Number.isInteger(quantity) || quantity < 1) {
        message.textContent = "Enter a valid quantity.";
        message.classList.add("error");
        return;
    }

    if (quantity > item.available) {
        message.textContent =
            `Only ${item.available} item(s) are currently available.`;
        message.classList.add("error");
        return;
    }

    if (!dueDate || dueDate < today()) {
        message.textContent = "Please select a valid return date.";
        message.classList.add("error");
        return;
    }

    item.available -= quantity;

    const transaction = {
        id: nextTransactionId(),
        borrower,
        borrowerId,
        role,
        equipmentName: item.name,
        barcode: item.barcode,
        quantity,
        borrowedAt: now(),
        dueDate,
        returnedAt: "",
        status: "Borrowed"
    };
    transactions.push(transaction);
    lastBorrowedTransaction = transaction;

    saveData();

    $("borrowForm").reset();
    $("borrowQuantity").value = 1;
    $("borrowBarcode").focus();
    message.textContent =
        `Borrowing recorded successfully for ${borrower}. Print the receipt below.`;
    message.classList.add("success");
    $("printReceiptBtn").classList.remove("hidden");

    renderAll();
});

$("printReceiptBtn").addEventListener("click", () => {
    if (lastBorrowedTransaction) {
        printBorrowReceipt(lastBorrowedTransaction);
    }
});


// ==========================================
// RETURN EQUIPMENT
// ==========================================

function renderReturnTable() {
    const active = transactions.filter(t => t.status === "Borrowed");

    $("returnTable").innerHTML = active.length
        ? [...active].reverse().map(t => `
            <tr>
                <td>${escapeHTML(t.borrower)}</td>
                <td>${escapeHTML(t.equipmentName)}</td>
                <td>${escapeHTML(t.barcode)}</td>
                <td>${escapeHTML(t.borrowedAt)}</td>
                <td>${dateText(t.dueDate)}</td>
                <td>
                    <button class="small-btn return-btn"
                        data-return="${t.id}">Return</button>
                </td>
            </tr>
        `).join("")
        : emptyRow(6, "No items waiting for return.");
}

function findReturnTransaction(barcode) {
    return transactions.find(t =>
        t.barcode.toLowerCase() === barcode.toLowerCase() &&
        t.status === "Borrowed"
    );
}

function processReturn(transaction) {
    if (!transaction || transaction.status !== "Borrowed") return;

    const item = equipment.find(eq => eq.barcode === transaction.barcode);

    if (!item) {
        alert("Equipment record not found.");
        return;
    }

    if (!confirm(
        `Confirm return of ${transaction.equipmentName} from ${transaction.borrower}?`
    )) return;

    item.available = Math.min(
        item.quantity,
        item.available + transaction.quantity
    );

    transaction.status = "Returned";
    transaction.returnedAt = now();

    saveData();
    $("returnResult").innerHTML =
        `<div class="result-box">Equipment returned successfully.</div>`;
    renderAll();
}

$("returnForm").addEventListener("submit", event => {
    event.preventDefault();

    const barcode = $("returnBarcode").value.trim();
    const transaction = findReturnTransaction(barcode);
    const result = $("returnResult");

    if (!transaction) {
        result.innerHTML =
            `<div class="result-box">No active borrowing record found for this barcode.</div>`;
        return;
    }

    result.innerHTML = `
        <div class="result-box">
            <strong>Borrowing Record Found</strong><br>
            Borrower: ${escapeHTML(transaction.borrower)}<br>
            ID Number: ${escapeHTML(transaction.borrowerId)}<br>
            Equipment: ${escapeHTML(transaction.equipmentName)}<br>
            Barcode: ${escapeHTML(transaction.barcode)}<br>
            Quantity: ${transaction.quantity}<br>
            Due Date: ${dateText(transaction.dueDate)}<br>
            Status: ${escapeHTML(transactionStatus(transaction))}<br>
            <button class="primary-btn" id="confirmReturn">
                Confirm Return
            </button>
        </div>
    `;

    $("confirmReturn").addEventListener("click", () => {
        processReturn(transaction);
    });
});

$("returnTable").addEventListener("click", event => {
    const button = event.target.closest("[data-return]");
    if (!button) return;

    const transaction = transactions.find(t =>
        t.id === Number(button.dataset.return)
    );

    processReturn(transaction);
});

// ==========================================
// TRANSACTION HISTORY
// ==========================================

function renderHistory() {
    const search = $("historySearch").value.toLowerCase();

    const filtered = [...transactions].reverse().filter(t =>
        t.borrower.toLowerCase().includes(search) ||
        t.borrowerId.toLowerCase().includes(search) ||
        t.equipmentName.toLowerCase().includes(search) ||
        t.barcode.toLowerCase().includes(search)
    );

    $("historyTable").innerHTML = filtered.length
        ? filtered.map(t => `
            <tr>
                <td><strong>${escapeHTML(t.borrower)}</strong></td>
                <td>${escapeHTML(t.borrowerId)}</td>
                <td>${escapeHTML(t.equipmentName)}</td>
                <td>${escapeHTML(t.barcode)}</td>
                <td>${escapeHTML(t.borrowedAt)}</td>
                <td>${dateText(t.dueDate)}</td>
                <td>${escapeHTML(t.returnedAt || "—")}</td>
                <td>${statusBadge(transactionStatus(t))}</td>
            </tr>
        `).join("")
        : emptyRow(8, "No transaction records found.");
}

$("historySearch").addEventListener("input", renderHistory);

// ==========================================
// EXPORT HISTORY TO CSV
// ==========================================

$("exportBtn").addEventListener("click", () => {
    if (!transactions.length) {
        alert("There are no transactions to export.");
        return;
    }

    const headers = [
        "Borrower", "ID Number", "Role", "Equipment",
        "Barcode", "Quantity", "Borrowed Date",
        "Due Date", "Returned Date", "Status"
    ];

    const rows = transactions.map(t => [
        t.borrower,
        t.borrowerId,
        t.role,
        t.equipmentName,
        t.barcode,
        t.quantity,
        t.borrowedAt,
        t.dueDate,
        t.returnedAt,
        transactionStatus(t)
    ]);

    const csvCell = value =>
        '"' + String(value ?? "").replace(/"/g, '""') + '"';

    const csv = [headers, ...rows]
        .map(row => row.map(csvCell).join(","))
        .join("\r\n");

    const blob = new Blob(["\uFEFF" + csv], {
        type: "text/csv;charset=utf-8;"
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "DECKTRACK_Transaction_History.csv";
    link.click();

    URL.revokeObjectURL(url);
});

// ==========================================
// REFRESH ALL DATA
// ==========================================

function renderAll() {
    renderDashboard();
    renderEquipment();
    renderBorrowed();
    renderReturnTable();
    renderHistory();
}

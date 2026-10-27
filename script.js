const db = supabase.createClient(
    "https://afnkvhshypzopwclerxy.supabase.co",
    "sb_publishable_gj_OKhp5OuT96MqHWgMNqw_RP2L4QgW"
);

// ==========================================
// DECKTRACK - JAVASCRIPT (Supabase version)
// ==========================================
// Login checks the "students" table. Equipment, borrowing, returns and
// history are stored in the "items" and "borrows" tables.

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

const capitalize = text => {
    const s = String(text ?? "");
    return s.charAt(0).toUpperCase() + s.slice(1);
};

// ==========================================
// DATA (loaded from Supabase)
// ==========================================

const BORROW_SELECT = "*, students(name, role), items(name)";

let equipment = [];
let transactions = [];
let loadErrorShown = false;

// The old demo data lived in the browser. It is no longer used.
try {
    localStorage.removeItem("deckEquipment");
    localStorage.removeItem("deckTransactions");
} catch (err) {
    // Browser storage may be blocked. Nothing to clean up in that case.
}

// Turns a row from the "borrows" table into the shape the screens use.
function mapBorrow(row) {
    return {
        id: row.id,
        borrower: row.students?.name || row.student_id,
        borrowerId: row.student_id,
        role: capitalize(row.students?.role || "student"),
        equipmentName: row.items?.name || row.item_barcode,
        barcode: row.item_barcode,
        quantity: row.quantity ?? 1,
        borrowedAt: row.borrowed_at
            ? new Date(row.borrowed_at).toLocaleString()
            : "",
        dueDate: row.due_date || "",
        returnedAt: row.returned_at
            ? new Date(row.returned_at).toLocaleString()
            : "",
        status: row.returned_at ? "Returned" : "Borrowed"
    };
}

async function loadData() {
    const [itemsRes, borrowsRes] = await Promise.all([
        db.from("items").select("*").order("name"),
        db.from("borrows").select(BORROW_SELECT).order("id", { ascending: true })
    ]);

    if (itemsRes.error) throw itemsRes.error;
    if (borrowsRes.error) throw borrowsRes.error;

    equipment = itemsRes.data || [];
    transactions = (borrowsRes.data || []).map(mapBorrow);
}

async function refreshData() {
    try {
        await loadData();
        loadErrorShown = false;
    } catch (err) {
        console.error("Could not load data:", err);
        if (!loadErrorShown) {
            loadErrorShown = true;
            alert("Could not load data from the database. " +
                "Check your internet connection and refresh the page.");
        }
    }
    renderAll();
}

async function findStudent(id) {
    const { data, error } = await db
        .from("students")
        .select("id_number, name, role")
        .eq("id_number", id)
        .maybeSingle();

    if (error) throw error;
    return data;
}

// Changes the "available" count of an item by +delta or -delta.
// It only writes if nobody else changed the count in the meantime,
// and retries a few times if someone did.
async function adjustAvailable(barcode, delta) {
    for (let attempt = 0; attempt < 4; attempt++) {
        const { data: item, error } = await db
            .from("items")
            .select("quantity, available")
            .eq("barcode", barcode)
            .maybeSingle();

        if (error) throw error;
        if (!item) return { ok: false, reason: "notfound" };

        const next = item.available + delta;

        if (next < 0) {
            return { ok: false, reason: "stock", available: item.available };
        }

        const capped = Math.min(next, item.quantity);

        const { data: rows, error: updateError } = await db
            .from("items")
            .update({ available: capped })
            .eq("barcode", barcode)
            .eq("available", item.available)
            .select("available");

        if (updateError) throw updateError;
        if (rows && rows.length) return { ok: true, available: rows[0].available };
    }

    return { ok: false, reason: "busy" };
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

$("loginForm").addEventListener("submit", async function(event) {
    event.preventDefault();

    const userId = $("userId").value.trim();
    const error = $("loginError");
    const button = this.querySelector("button[type='submit']");

    error.textContent = "";

    if (!userId) {
        error.textContent = "Please enter your CTU ID number.";
        return;
    }

    button.disabled = true;

    try {
        const student = await findStudent(userId);

        if (!student) {
            error.textContent =
                "ID number not registered. Please see the laboratory administrator.";
            return;
        }

        sessionStorage.setItem("deckLoggedIn", "true");
        sessionStorage.setItem("deckUserId", student.id_number);
        sessionStorage.setItem("deckUserName", student.name);
        showApp();
    } catch (err) {
        console.error("Login check failed:", err);
        error.textContent =
            "Could not reach the database. Check your internet connection and try again.";
    } finally {
        button.disabled = false;
    }
});

function showApp() {
    $("loginPage").classList.add("hidden");
    $("mainApp").classList.remove("hidden");

    const userId = sessionStorage.getItem("deckUserId") || "CTU User";
    const userName = sessionStorage.getItem("deckUserName") || userId;

    $("currentUserLabel").textContent = userName;
    $("currentUserAvatar").textContent = userName.charAt(0).toUpperCase();
    $("currentUserTopAvatar").textContent = userName.charAt(0).toUpperCase();
    $("currentDate").textContent = new Date().toLocaleDateString(
        undefined,
        { year: "numeric", month: "long", day: "numeric" }
    );

    renderAll();
    refreshData();
}

$("logoutBtn").addEventListener("click", () => {
    sessionStorage.removeItem("deckLoggedIn");
    sessionStorage.removeItem("deckUserId");
    sessionStorage.removeItem("deckUserName");
    $("mainApp").classList.add("hidden");
    $("loginPage").classList.remove("hidden");
    $("loginForm").reset();
    $("loginError").textContent = "";
});

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

    // Show what we have right away, then fetch the latest from the database.
    renderAll();
    refreshData();

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
        sum + Number(item.quantity || 0), 0
    );

    const available = equipment.reduce((sum, item) =>
        sum + Number(item.available || 0), 0
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
        String(item.name || "").toLowerCase().includes(search) ||
        String(item.barcode || "").toLowerCase().includes(search) ||
        String(item.category || "").toLowerCase().includes(search)
    );

    $("equipmentCount").textContent =
        `${filtered.length} equipment type(s)`;

    $("equipmentTable").innerHTML = filtered.length
        ? filtered.map(item => `
            <tr>
                <td><strong>${escapeHTML(item.name)}</strong></td>
                <td>${escapeHTML(item.barcode)}</td>
                <td>${escapeHTML(item.category || "—")}</td>
                <td>${item.quantity}</td>
                <td>${item.available}</td>
                <td>${statusBadge(
                    item.available > 0 ? "Available" : "Borrowed"
                )}</td>
                <td>
                    <button class="small-btn delete-btn"
                        data-delete="${escapeHTML(item.barcode)}">Delete</button>
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

$("equipmentForm").addEventListener("submit", async event => {
    event.preventDefault();

    const name = $("eqName").value.trim();
    const barcode = $("eqBarcode").value.trim();
    const category = $("eqCategory").value.trim();
    const quantity = Number($("eqQuantity").value);
    const button = event.target.querySelector("button[type='submit']");

    if (equipment.some(item =>
        String(item.barcode).toLowerCase() === barcode.toLowerCase()
    )) {
        alert("This barcode is already registered.");
        return;
    }

    if (quantity < 1 || !Number.isInteger(quantity)) {
        alert("Enter a valid whole-number quantity.");
        return;
    }

    button.disabled = true;

    try {
        const { error } = await db.from("items").insert({
            barcode,
            name,
            category,
            quantity,
            available: quantity
        });

        if (error) {
            alert(error.code === "23505"
                ? "This barcode is already registered."
                : "Could not save the equipment: " + error.message);
            return;
        }

        $("equipmentForm").reset();
        $("addEquipmentPanel").classList.add("hidden");
        await refreshData();
        alert("Equipment added successfully!");
    } catch (err) {
        console.error(err);
        alert("Could not save the equipment: " + err.message);
    } finally {
        button.disabled = false;
    }
});

$("equipmentTable").addEventListener("click", async event => {
    const button = event.target.closest("[data-delete]");
    if (!button) return;

    const barcode = button.dataset.delete;
    const item = equipment.find(eq => eq.barcode === barcode);

    if (!item) return;

    const hasActiveBorrow = transactions.some(t =>
        t.barcode === item.barcode && t.status === "Borrowed"
    );

    if (hasActiveBorrow) {
        alert("This equipment has active borrowing records and cannot be deleted.");
        return;
    }

    if (!confirm(`Delete ${item.name} from the inventory?`)) return;

    try {
        const { error } = await db
            .from("items")
            .delete()
            .eq("barcode", item.barcode);

        if (error) {
            alert(error.code === "23503"
                ? "This equipment has borrowing history, so it cannot be deleted."
                : "Could not delete the equipment: " + error.message);
            return;
        }

        await refreshData();
    } catch (err) {
        console.error(err);
        alert("Could not delete the equipment: " + err.message);
    }
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

function setBorrowMessage(text, type) {
    const message = $("borrowMessage");
    message.className = "message";
    message.textContent = text;
    if (type) message.classList.add(type);
}

// Fills the name and role fields from the students table.
function fillBorrower(student) {
    $("borrowerName").value = student ? student.name : "";
    $("borrowerRole").value = student ? capitalize(student.role) : "";
}

$("borrowerId").addEventListener("change", async () => {
    const id = $("borrowerId").value.trim();
    fillBorrower(null);

    if (!id) return;

    try {
        const student = await findStudent(id);
        fillBorrower(student);

        if (!student) {
            setBorrowMessage("ID number not registered.", "error");
        } else {
            setBorrowMessage("", "");
        }
    } catch (err) {
        console.error(err);
        setBorrowMessage("Could not check the ID number. Try again.", "error");
    }
});

let lastBorrowedTransaction = null;
let borrowBusy = false;

async function handleBorrow() {
    lastBorrowedTransaction = null;
    $("printReceiptBtn").classList.add("hidden");

    const borrowerId = $("borrowerId").value.trim();
    const barcode = $("borrowBarcode").value.trim();
    const quantity = Number($("borrowQuantity").value);
    const dueDate = $("dueDate").value;

    const student = await findStudent(borrowerId);

    if (!student) {
        fillBorrower(null);
        setBorrowMessage(
            "ID number not registered. Ask the laboratory administrator to add it first.",
            "error"
        );
        return;
    }

    fillBorrower(student);

    const findItem = () => equipment.find(eq =>
        String(eq.barcode).toLowerCase() === barcode.toLowerCase()
    );

    let item = findItem();

    if (!item) {
        await refreshData();
        item = findItem();
    }

    if (!item) {
        setBorrowMessage("Equipment barcode not found.", "error");
        return;
    }

    if (!Number.isInteger(quantity) || quantity < 1) {
        setBorrowMessage("Enter a valid quantity.", "error");
        return;
    }

    if (!dueDate || dueDate < today()) {
        setBorrowMessage("Please select a valid return date.", "error");
        return;
    }

    // Take the items out of stock first.
    const stock = await adjustAvailable(item.barcode, -quantity);

    if (!stock.ok) {
        if (stock.reason === "stock") {
            setBorrowMessage(
                `Only ${stock.available} item(s) are currently available.`,
                "error"
            );
        } else if (stock.reason === "busy") {
            setBorrowMessage(
                "The equipment record is busy. Please try again.",
                "error"
            );
        } else {
            setBorrowMessage("Equipment barcode not found.", "error");
        }
        await refreshData();
        return;
    }

    // Then record the borrowing. If that fails, put the stock back.
    const { data, error } = await db
        .from("borrows")
        .insert({
            student_id: student.id_number,
            item_barcode: item.barcode,
            quantity,
            due_date: dueDate
        })
        .select(BORROW_SELECT)
        .single();

    if (error) {
        console.error(error);
        await adjustAvailable(item.barcode, quantity);
        setBorrowMessage(
            "Could not record the borrowing: " + error.message,
            "error"
        );
        await refreshData();
        return;
    }

    const transaction = mapBorrow(data);
    lastBorrowedTransaction = transaction;

    $("borrowForm").reset();
    fillBorrower(null);
    $("borrowQuantity").value = 1;
    $("borrowBarcode").focus();

    setBorrowMessage(
        `Borrowing recorded successfully for ${transaction.borrower}. Print the receipt below.`,
        "success"
    );
    $("printReceiptBtn").classList.remove("hidden");

    await refreshData();
}

$("borrowForm").addEventListener("submit", async event => {
    event.preventDefault();

    if (borrowBusy) return;
    borrowBusy = true;

    try {
        await handleBorrow();
    } catch (err) {
        console.error(err);
        setBorrowMessage("Something went wrong: " + err.message, "error");
    } finally {
        borrowBusy = false;
    }
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
        String(t.barcode).toLowerCase() === barcode.toLowerCase() &&
        t.status === "Borrowed"
    );
}

async function processReturn(transaction) {
    if (!transaction || transaction.status !== "Borrowed") return;

    if (!confirm(
        `Confirm return of ${transaction.equipmentName} from ${transaction.borrower}?`
    )) return;

    try {
        // Mark the borrowing as returned (only if it is still open).
        const { data: updated, error } = await db
            .from("borrows")
            .update({ returned_at: new Date().toISOString() })
            .eq("id", transaction.id)
            .is("returned_at", null)
            .select("id");

        if (error) throw error;

        if (!updated || !updated.length) {
            alert("This item was already returned.");
            await refreshData();
            return;
        }

        // Put the items back in stock.
        const stock = await adjustAvailable(
            transaction.barcode,
            transaction.quantity
        );

        if (!stock.ok && stock.reason === "notfound") {
            alert("Equipment record not found, but the return was saved.");
        }

        $("returnResult").innerHTML =
            `<div class="result-box">Equipment returned successfully.</div>`;
        await refreshData();
    } catch (err) {
        console.error(err);
        alert("Could not save the return: " + err.message);
    }
}

$("returnForm").addEventListener("submit", async event => {
    event.preventDefault();

    const barcode = $("returnBarcode").value.trim();
    const result = $("returnResult");

    await refreshData();

    const transaction = findReturnTransaction(barcode);

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
        String(t.borrower).toLowerCase().includes(search) ||
        String(t.borrowerId).toLowerCase().includes(search) ||
        String(t.equipmentName).toLowerCase().includes(search) ||
        String(t.barcode).toLowerCase().includes(search)
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

    const blob = new Blob(["﻿" + csv], {
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
// REFRESH ALL SCREENS
// ==========================================

function renderAll() {
    renderDashboard();
    renderEquipment();
    renderBorrowed();
    renderReturnTable();
    renderHistory();
}

// Stay logged in after a page refresh (same browser tab).
if (sessionStorage.getItem("deckLoggedIn") === "true") {
    showApp();
}
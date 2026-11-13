const db = supabase.createClient(
    "https://afnkvhshypzopwclerxy.supabase.co",
    "sb_publishable_gj_OKhp5OuT96MqHWgMNqw_RP2L4QgW"
);

// ==========================================
// DECKTRACK - JAVASCRIPT (Supabase version)
// ==========================================
// STUDENT PORTAL. Only people whose role is "student" can sign in here.
// A student only ever sees and changes their OWN borrowings; equipment is
// read-only. Adding equipment and checking everyone's records is done on
// the separate Instructor Portal (instructor.html).
// Borrowing and returning are NOT done on this website: they are done on the
// DECKTRACK hardware device. This site only shows equipment and the
// student's own history.
// Login checks the "students" table. Equipment, borrowing and history are
// stored in the "items" and "borrows" tables.

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

// "Nov 12, 2026, 5:00 PM" when the exact time is known, otherwise just the date.
const dueText = t => t.dueAt
    ? new Date(t.dueAt).toLocaleString(undefined, {
        month: "short", day: "numeric", year: "numeric",
        hour: "numeric", minute: "2-digit"
    })
    : dateText(t.dueDate);

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
let me = null;   // the signed-in student: { id, name }

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
        dueAt: row.due_at || "",
        returnedAt: row.returned_at
            ? new Date(row.returned_at).toLocaleString()
            : "",
        status: row.returned_at ? "Returned" : "Borrowed"
    };
}

async function loadData() {
    const [itemsRes, borrowsRes] = await Promise.all([
        db.from("items").select("*").order("name"),
        db.from("borrows").select(BORROW_SELECT)
            .eq("student_id", me ? me.id : "")      // only this student's records
            .order("id", { ascending: true })
    ]);

    if (itemsRes.error) throw itemsRes.error;
    if (borrowsRes.error) throw borrowsRes.error;

    equipment = itemsRes.data || [];
    transactions = (borrowsRes.data || []).map(mapBorrow);
}

async function refreshData() {
    if (!me) return;
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

function isOverdue(transaction) {
    if (transaction.status !== "Borrowed") return false;
    if (transaction.dueAt) return Date.now() > new Date(transaction.dueAt).getTime();
    return transaction.dueDate < today();
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

        if (String(student.role || "").toLowerCase() !== "student") {
            error.textContent =
                "This portal is for students only. Instructors, please use the Instructor Portal.";
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
    me = { id: userId, name: userName };
    equipment = [];
    transactions = [];

    $("currentUserLabel").textContent = userName;
    $("currentUserAvatar").textContent = userName.charAt(0).toUpperCase();
    $("currentUserTopAvatar").textContent = userName.charAt(0).toUpperCase();
    $("currentDate").textContent = new Date().toLocaleDateString(
        undefined,
        { year: "numeric", month: "long", day: "numeric" }
    );

    renderAll();
    refreshData();
    loadMyPhone();
}

function normalizeEmail(value) {
    const v = String(value || "").trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
}

async function loadMyPhone() {
    if (!me) return;
    const { data, error } = await db.from("students")
        .select("email").eq("id_number", me.id).maybeSingle();
    if (error) {
        $("phoneBox").classList.add("hidden");   // email column not set up yet
        return;
    }
    $("phoneBox").classList.remove("hidden");
    $("myPhone").value = (data && data.email) || "";
}

$("savePhoneBtn").addEventListener("click", async () => {
    if (!me) return;
    const msg = $("phoneMessage");
    const email = normalizeEmail($("myPhone").value);
    if (!email) {
        msg.textContent = "Enter a valid email address, for example juan@gmail.com.";
        return;
    }
    const { data, error } = await db.from("students")
        .update({ email }).eq("id_number", me.id).select("id_number");
    if (error || !data || !data.length) {
        msg.textContent = "Could not save your email. Please tell the laboratory administrator.";
        return;
    }
    $("myPhone").value = email;
    msg.textContent = "Saved. You will be emailed when your equipment is due.";
});

$("logoutBtn").addEventListener("click", () => {
    sessionStorage.removeItem("deckLoggedIn");
    sessionStorage.removeItem("deckUserId");
    sessionStorage.removeItem("deckUserName");
    me = null;
    equipment = [];
    transactions = [];
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
    history: "My History"
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

    const notice = $("dueNotice");
    const dueToday = transactions.filter(t =>
        t.status === "Borrowed" && !isOverdue(t) && t.dueDate === today());
    const late = transactions.filter(isOverdue);
    const parts = [];
    if (late.length) parts.push(`${late.length} overdue item(s): ` +
        late.map(t => escapeHTML(t.equipmentName)).join(", "));
    if (dueToday.length) parts.push(`${dueToday.length} item(s) due today: ` +
        dueToday.map(t => escapeHTML(t.equipmentName)).join(", "));
    notice.innerHTML = parts.length
        ? "&#9888; " + parts.join(" &middot; ") + ". Please return them to the laboratory."
        : "";
    notice.classList.toggle("hidden", !parts.length);

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
            </tr>
        `).join("")
        : emptyRow(6);
}

$("equipmentSearch").addEventListener("input", renderEquipment);

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
                <td>${dueText(t)}</td>
                <td>${escapeHTML(t.returnedAt || "—")}</td>
                <td>${statusBadge(transactionStatus(t))}</td>
            </tr>
        `).join("")
        : emptyRow(8, "No records found.");
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
        dueText(t),
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
    link.download = "DECKTRACK_My_History.csv";
    link.click();

    URL.revokeObjectURL(url);
});

// ==========================================
// REFRESH ALL SCREENS
// ==========================================

function renderAll() {
    renderDashboard();
    renderEquipment();
    renderHistory();
}

// Stay logged in after a page refresh (same browser tab).
if (sessionStorage.getItem("deckLoggedIn") === "true") {
    showApp();
}
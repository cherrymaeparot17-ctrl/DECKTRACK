const db = supabase.createClient(
    "https://afnkvhshypzopwclerxy.supabase.co",
    "sb_publishable_gj_OKhp5OuT96MqHWgMNqw_RP2L4QgW"
);

// ==========================================
// DECKTRACK - LAB IN-CHARGE PORTAL
// ==========================================
// For the Laboratory In-Charge only. They sign in with their ID number
// (their role in the "students" table must be Lab In-Charge). From here they can:
//   - check every transaction and all equipment
//   - add or delete equipment
//   - save students' emails and send the due-date email reminders
// Students use the separate Student Portal (index.html).

const $ = id => document.getElementById(id);

const today = () => {
    const d = new Date();
    return d.getFullYear() + "-" +
        String(d.getMonth() + 1).padStart(2, "0") + "-" +
        String(d.getDate()).padStart(2, "0");
};

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

const BORROW_SELECT = "*, students(name, role, email), items(name)";
const BORROW_SELECT_NO_EMAIL = "*, students(name, role), items(name)";

let equipment = [];
let transactions = [];
let students = [];
let smsReady = true;        // false until supabase_setup.sql has been run
let loadErrorShown = false;

function mapBorrow(row) {
    return {
        id: row.id,
        borrower: row.students?.name || row.student_id,
        borrowerId: row.student_id,
        role: capitalize(row.students?.role || "student"),
        email: row.students?.email || "",
        equipmentName: row.items?.name || row.item_barcode,
        barcode: row.item_barcode,
        quantity: row.quantity ?? 1,
        borrowedAt: row.borrowed_at
            ? new Date(row.borrowed_at).toLocaleString()
            : "",
        dueDate: row.due_date || "",
        dueAt: row.due_at || "",
        overdueSentAt: row.overdue_email_sent_at || "",
        returnedAt: row.returned_at
            ? new Date(row.returned_at).toLocaleString()
            : "",
        smsSentAt: row.due_sms_sent_at || "",
        status: row.returned_at ? "Returned" : "Borrowed"
    };
}

async function loadData() {
    const itemsReq = db.from("items").select("*").order("name");
    let borrowsRes = await db.from("borrows").select(BORROW_SELECT)
        .order("id", { ascending: true });

    // The email column does not exist yet: load without it and warn.
    if (borrowsRes.error) {
        smsReady = false;
        borrowsRes = await db.from("borrows").select(BORROW_SELECT_NO_EMAIL)
            .order("id", { ascending: true });
    } else {
        smsReady = true;
    }

    const itemsRes = await itemsReq;
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

// Exact return time when known, otherwise the date only.
const dueText = t => t.dueAt
    ? new Date(t.dueAt).toLocaleString(undefined, {
        month: "short", day: "numeric", year: "numeric",
        hour: "numeric", minute: "2-digit"
    })
    : dateText(t.dueDate);

function isOverdue(t) {
    if (t.status !== "Borrowed") return false;
    if (t.dueAt) return Date.now() > new Date(t.dueAt).getTime();
    return t.dueDate < today();
}

function isDueToday(t) {
    return t.status === "Borrowed" && !isOverdue(t) && t.dueDate === today();
}

// Due or overdue at this moment (used for the dashboard list).
function isDueNow(t) {
    if (t.status !== "Borrowed") return false;
    if (t.dueAt) return Date.now() >= new Date(t.dueAt).getTime();
    return t.dueDate <= today();
}

const dueSortKey = t => t.dueAt || (t.dueDate + "T08:00:00+08:00");

function transactionStatus(t) {
    if (t.status === "Returned") return "Returned";
    return isOverdue(t) ? "Overdue" : "Borrowed";
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

function smsTag(t) {
    if (!smsReady) return `<span class="sms-tag none">Not set up</span>`;
    if (t.overdueSentAt) {
        return `<span class="sms-tag sent">2 emails sent</span>`;
    }
    if (t.smsSentAt) {
        return `<span class="sms-tag sent">Sent ${escapeHTML(
            new Date(t.smsSentAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
        )}</span>`;
    }
    if (!t.email) return `<span class="sms-tag nophone">No email</span>`;
    return `<span class="sms-tag wait">Waiting to send</span>`;
}

// ==========================================
// LOGIN AND LOGOUT (Laboratory In-Charge only)
// ==========================================

$("loginForm").addEventListener("submit", async function(event) {
    event.preventDefault();

    const userId = $("userId").value.trim();
    const error = $("loginError");
    const button = this.querySelector("button[type='submit']");

    error.textContent = "";

    if (!userId) {
        error.textContent = "Please enter your ID number.";
        return;
    }

    button.disabled = true;

    try {
        const { data: person, error: dbError } = await db
            .from("students")
            .select("id_number, name, role")
            .eq("id_number", userId)
            .maybeSingle();

        if (dbError) {
            console.error("Lab In-Charge login failed:", dbError);
            error.textContent =
                "Could not reach the database. Check your internet connection and try again.";
            return;
        }

        // The role may be typed a few ways: "Lab In-Charge", "Laboratory Incharge", ...
        const roleKey = String(person?.role || "").toLowerCase().replace(/[^a-z]/g, "");
        const isInCharge = ["labincharge", "laboratoryincharge", "incharge", "admin"]
            .includes(roleKey);

        if (!person || !isInCharge) {
            error.textContent =
                "This ID is not registered as Laboratory In-Charge.";
            return;
        }

        sessionStorage.setItem("deckInstLoggedIn", "true");
        sessionStorage.setItem("deckInstId", person.id_number);
        sessionStorage.setItem("deckInstName", person.name);
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

    const name = sessionStorage.getItem("deckInstName") ||
        sessionStorage.getItem("deckInstId") || "Lab In-Charge";

    $("currentUserLabel").textContent = name;
    $("currentUserAvatar").textContent = name.charAt(0).toUpperCase();
    $("currentUserTopAvatar").textContent = name.charAt(0).toUpperCase();
    $("currentDate").textContent = new Date().toLocaleDateString(
        undefined,
        { year: "numeric", month: "long", day: "numeric" }
    );

    renderAll();
    refreshData();
}

$("logoutBtn").addEventListener("click", () => {
    sessionStorage.removeItem("deckInstLoggedIn");
    sessionStorage.removeItem("deckInstId");
    sessionStorage.removeItem("deckInstName");
    equipment = [];
    transactions = [];
    students = [];
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
    history: "Transactions",
    students: "Students & Emails"
};

function openPage(pageId) {
    document.querySelectorAll(".page").forEach(page => {
        page.classList.remove("active-page");
    });

    document.querySelectorAll(".nav-link").forEach(link => {
        link.classList.remove("active");
    });

    $(pageId).classList.add("active-page");

    const nav = document.querySelector(`.nav-link[data-page="${pageId}"]`);
    if (nav) nav.classList.add("active");

    $("pageTitle").textContent = pageNames[pageId] || "DECKTRACK";

    renderAll();
    refreshData();
    if (pageId === "students") loadStudents();
}

document.querySelectorAll(".nav-link").forEach(button => {
    button.addEventListener("click", () => openPage(button.dataset.page));
});

document.querySelectorAll("[data-goto]").forEach(button => {
    button.addEventListener("click", () => openPage(button.dataset.goto));
});

// ==========================================
// DASHBOARD
// ==========================================

function renderDashboard() {
    const total = equipment.reduce((sum, item) =>
        sum + Number(item.quantity || 0), 0);
    const available = equipment.reduce((sum, item) =>
        sum + Number(item.available || 0), 0);
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

    const due = transactions
        .filter(isDueNow)
        .sort((a, b) => new Date(dueSortKey(a)) - new Date(dueSortKey(b)));

    $("dueTable").innerHTML = due.length
        ? due.map(t => `
            <tr>
                <td><strong>${escapeHTML(t.borrower)}</strong><br>
                    <span class="muted">${escapeHTML(t.borrowerId)}</span></td>
                <td>${escapeHTML(t.equipmentName)}</td>
                <td>${t.quantity}</td>
                <td>${dueText(t)}</td>
                <td>${isDueToday(t)
                    ? `<span class="badge borrowed">Due Today</span>`
                    : statusBadge("Overdue")}</td>
                <td>${smsTag(t)}</td>
            </tr>
        `).join("")
        : emptyRow(6, "Nothing is due or overdue.");

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

    const note = $("setupNote");
    if (!smsReady) {
        note.innerHTML = "<strong>Email reminders are not set up yet.</strong> " +
            "Run <code>supabase_setup.sql</code> in the Supabase SQL Editor, then refresh this page.";
        note.classList.remove("hidden");
    } else {
        note.classList.add("hidden");
    }
}

// ==========================================
// EQUIPMENT INVENTORY (check, add, delete)
// ==========================================

function renderEquipment() {
    const search = $("equipmentSearch").value.toLowerCase();

    const filtered = equipment.filter(item =>
        String(item.name || "").toLowerCase().includes(search) ||
        String(item.barcode || "").toLowerCase().includes(search) ||
        String(item.category || "").toLowerCase().includes(search)
    );

    $("equipmentCount").textContent = `${filtered.length} equipment type(s)`;

    $("equipmentTable").innerHTML = filtered.length
        ? filtered.map(item => `
            <tr>
                <td><strong>${escapeHTML(item.name)}</strong></td>
                <td>${escapeHTML(item.barcode)}</td>
                <td>${escapeHTML(item.category || "—")}</td>
                <td>${item.quantity}</td>
                <td>${item.available}</td>
                <td>${statusBadge(item.available > 0 ? "Available" : "Borrowed")}</td>
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

    const item = equipment.find(eq => eq.barcode === button.dataset.delete);
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
// TRANSACTIONS
// ==========================================

function renderHistory() {
    const search = $("historySearch").value.toLowerCase();
    const status = $("historyStatus").value;

    const filtered = [...transactions].reverse().filter(t =>
        (!status || transactionStatus(t) === status) &&
        (String(t.borrower).toLowerCase().includes(search) ||
        String(t.borrowerId).toLowerCase().includes(search) ||
        String(t.equipmentName).toLowerCase().includes(search) ||
        String(t.barcode).toLowerCase().includes(search))
    );

    $("historyCount").textContent = `${filtered.length} record(s)`;

    $("historyTable").innerHTML = filtered.length
        ? filtered.map(t => `
            <tr>
                <td><strong>${escapeHTML(t.borrower)}</strong></td>
                <td>${escapeHTML(t.borrowerId)}</td>
                <td>${escapeHTML(t.equipmentName)}</td>
                <td>${escapeHTML(t.barcode)}</td>
                <td>${t.quantity}</td>
                <td>${escapeHTML(t.borrowedAt)}</td>
                <td>${dueText(t)}</td>
                <td>${escapeHTML(t.returnedAt || "—")}</td>
                <td>${statusBadge(transactionStatus(t))}</td>
            </tr>
        `).join("")
        : emptyRow(9, "No transaction records found.");
}

$("historySearch").addEventListener("input", renderHistory);
$("historyStatus").addEventListener("change", renderHistory);

$("exportBtn").addEventListener("click", () => {
    if (!transactions.length) {
        alert("There are no transactions to export.");
        return;
    }

    const headers = [
        "Borrower", "ID Number", "Role", "Equipment",
        "Barcode", "Quantity", "Borrowed Date",
        "Due", "Returned Date", "Status", "Due Email Sent", "Late Email Sent"
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
        transactionStatus(t),
        t.smsSentAt ? new Date(t.smsSentAt).toLocaleString() : "",
        t.overdueSentAt ? new Date(t.overdueSentAt).toLocaleString() : ""
    ]);

    const csvCell = value =>
        '"' + String(value ?? "").replace(/"/g, '""') + '"';

    const csv = [headers, ...rows]
        .map(row => row.map(csvCell).join(","))
        .join("\r\n");

    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "DECKTRACK_Transaction_History.csv";
    link.click();

    URL.revokeObjectURL(url);
});

// ==========================================
// STUDENTS AND EMAIL REMINDERS
// ==========================================

// Accepts 09XXXXXXXXX, 9XXXXXXXXX, 639XXXXXXXXX or +639XXXXXXXXX and
// returns the 09XXXXXXXXX form, or null when it is not a Philippine mobile number.
function normalizeEmail(value) {
    const v = String(value || "").trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
}

async function loadStudents() {
    let res = await db.from("students")
        .select("id_number, name, role, email")
        .order("name");

    if (res.error) {
        smsReady = false;
        res = await db.from("students")
            .select("id_number, name, role")
            .order("name");
    }

    if (res.error) {
        console.error(res.error);
        students = [];
    } else {
        students = res.data || [];
    }
    renderStudents();
    renderDashboard();
}

function renderStudents() {
    const search = $("studentSearch").value.toLowerCase();

    const filtered = students.filter(s =>
        String(s.name || "").toLowerCase().includes(search) ||
        String(s.id_number || "").toLowerCase().includes(search)
    );

    $("studentCount").textContent = `${filtered.length} person(s)`;

    $("studentTable").innerHTML = filtered.length
        ? filtered.map(s => `
            <tr>
                <td><strong>${escapeHTML(s.name)}</strong></td>
                <td>${escapeHTML(s.id_number)}</td>
                <td>${escapeHTML(capitalize(s.role))}</td>
                <td>
                    <input class="phone-input" type="email" inputmode="email"
                        placeholder="name@gmail.com"
                        value="${escapeHTML(s.email || "")}"
                        data-email-for="${escapeHTML(s.id_number)}"
                        ${smsReady ? "" : "disabled"}>
                </td>
                <td>
                    <button class="save-btn" data-save="${escapeHTML(s.id_number)}"
                        ${smsReady ? "" : "disabled"}>Save</button>
                </td>
            </tr>
        `).join("")
        : emptyRow(5, "No students found.");
}

$("studentSearch").addEventListener("input", renderStudents);

$("studentTable").addEventListener("click", async event => {
    const button = event.target.closest("[data-save]");
    if (!button) return;

    const id = button.dataset.save;
    const input = [...document.querySelectorAll("[data-email-for]")]
        .find(el => el.dataset.emailFor === id);
    const raw = input.value.trim();
    const email = raw ? normalizeEmail(raw) : null;

    if (raw && !email) {
        alert("Enter a valid email address, for example juan@gmail.com.");
        return;
    }

    button.disabled = true;

    try {
        const { data, error } = await db.from("students")
            .update({ email })
            .eq("id_number", id)
            .select("id_number");

        if (error) throw error;
        if (!data || !data.length) {
            alert("The number was not saved. The database may not allow the Lab In-Charge to update students yet.");
            return;
        }

        const row = students.find(s => String(s.id_number) === id);
        if (row) row.email = email;
        input.value = email || "";
        button.textContent = "Saved ✓";
        setTimeout(() => { button.textContent = "Save"; }, 1500);
        await refreshData();
    } catch (err) {
        console.error(err);
        alert("Could not save the number: " + err.message);
    } finally {
        button.disabled = false;
    }
});

// Sends the emails that are waiting right now (the same job also runs automatically every 15 minutes).
$("sendDueBtn").addEventListener("click", async () => {
    const button = $("sendDueBtn");
    const message = $("sendDueMessage");

    button.disabled = true;
    message.className = "message";
    message.textContent = "Sending...";

    try {
        const { data, error } = await db.functions.invoke("send-due-email", { body: {} });

        if (error) throw error;

        const sent = data?.sent ?? 0;
        const noEmail = data?.no_email ?? 0;
        const failed = data?.failed ?? 0;

        message.className = "message " + (failed ? "error" : "success");
        message.textContent = sent || noEmail || failed
            ? `${sent} email(s) sent` +
              (noEmail ? `, ${noEmail} borrower(s) have no email` : "") +
              (failed ? `, ${failed} failed (they will be retried)` : "") + "."
            : "No emails are waiting. Nothing is due, or everyone was already emailed.";

        await refreshData();
    } catch (err) {
        console.error(err);
        message.className = "message error";
        message.textContent =
            "Could not send the emails. Check that the send-due-email function is deployed and the Brevo key is set.";
    } finally {
        button.disabled = false;
    }
});

// ==========================================
// REFRESH ALL SCREENS
// ==========================================

function renderAll() {
    renderDashboard();
    renderEquipment();
    renderHistory();
    renderStudents();
}

// Stay signed in after a page refresh (same browser tab).
if (sessionStorage.getItem("deckInstLoggedIn") === "true") {
    showApp();
}
"""
=============================================================================
FILE: toolkit.py
PROJECT: ROTCIMS — San Enrique ROTC Unit Management System
PURPOSE: Advanced Executive Command & Operations Toolkit for Supabase:
  [1] Cadet Personnel Management (Enlist, 201 Dossier, Unit Transfer, Status)
  [2] Live Multi-Unit Company Roster (Alpha, Bravo, Charlie, Medics, GHQ)
      with Instant Auto-Refresh Watch Mode
  [3] Cadet Search Console (Continuous Interactive Loop)
  [4] Batch Military QR Pass Badge Generator (Generates All Cadets in 1-Click)
  [5] Formation Drill & Quick Attendance Console
  [6] Database Health Diagnostic & Latency Ping
  [7] Data Export & Official Battalion Ledger (.CSV)
  [8] Exit
=============================================================================
"""

import os
import sys
import csv
import time
import datetime
from supabase import create_client, Client

# Ensure UTF-8 output on all Windows command prompts and PowerShell terminals
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# Windows non-blocking keyboard input
try:
    import msvcrt
    MSVCRT_AVAILABLE = True
except ImportError:
    MSVCRT_AVAILABLE = False

# High-resolution QR Pass Badge Generator (Pillow & Qrcode)
try:
    import qrcode
    from PIL import Image, ImageDraw, ImageFont
    QR_SUPPORT = True
except ImportError:
    QR_SUPPORT = False

# ====== SUPABASE CREDENTIALS ======
SUPABASE_URL = "https://cntisxkugmvwsommzjom.supabase.co"
SUPABASE_KEY = "sb_publishable_crUK3jaModJMUqnZjnma_w_-9i-CEns"

# Output directory for QR code pass images
QR_DIR = "qr_passes"
os.makedirs(QR_DIR, exist_ok=True)

# ANSI Color Palette for Military Command Console
os.system("")  # Initialize Windows Virtual Terminal sequences
GOLD = "\033[1;33m"
GREEN = "\033[1;32m"
CYAN = "\033[1;36m"
RED = "\033[1;31m"
GRAY = "\033[0;37m"
BOLD = "\033[1m"
RESET = "\033[0m"


def clear_screen():
    """Clears the terminal screen to remove clutter and old commands."""
    os.system("cls" if os.name == "nt" else "clear")


# Initialize Supabase Client
try:
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
except Exception as e:
    print(f"\n[ERROR] Failed to connect to Supabase: {e}")
    sys.exit(1)


# =============================================================================
# ENGINE: MILITARY QR PASS BADGE GENERATOR
# =============================================================================
def generate_qr_pass(student_id: str, full_name: str, unit: str = "Alpha Company", rank: str = "Cadet") -> str:
    """Generates a high-contrast printable military QR ID card saved as PNG."""
    if not QR_SUPPORT:
        return ""

    try:
        W, H = 420, 560
        badge = Image.new("RGB", (W, H), "#ffffff")
        draw = ImageDraw.Draw(badge)

        # Dark Military Green Top Banner
        draw.rectangle([(0, 0), (W, 78)], fill="#0c2014")
        # Brass Accent Line
        draw.rectangle([(0, 78), (W, 83)], fill="#b88e2c")

        # Header Titles
        draw.text((W // 2, 24), "SAN ENRIQUE ROTC UNIT", fill="#f3d47f", anchor="mm")
        draw.text((W // 2, 48), "604TH CDC • 6RCDG • ARESCOM", fill="#ffffff", anchor="mm")
        draw.text((W // 2, 66), "OFFICIAL FORMATION DRILL PASS", fill="#9ca3af", anchor="mm")

        # Generate Scannable QR Code
        qr = qrcode.QRCode(
            version=1,
            error_correction=qrcode.constants.ERROR_CORRECT_M,
            box_size=6,
            border=2,
        )
        qr.add_data(student_id)
        qr.make(fit=True)
        qr_img = qr.make_image(fill_color="#0c2014", back_color="white").convert("RGB")
        qr_w, qr_h = qr_img.size

        # Center QR code
        qr_top = 100
        badge.paste(qr_img, ((W - qr_w) // 2, qr_top))

        # Cadet Information Card Section
        info_top = qr_top + qr_h + 15
        draw.rectangle([(20, info_top), (W - 20, H - 25)], fill="#f9fafb", outline="#e5e7eb", width=1)
        draw.rectangle([(20, info_top), (W - 20, info_top + 4)], fill="#b88e2c")

        # Cadet Name & Details
        draw.text((W // 2, info_top + 28), full_name.upper()[:25], fill="#111827", anchor="mm")
        draw.text((W // 2, info_top + 54), f"STUDENT ID: {student_id}", fill="#b88e2c", anchor="mm")
        draw.text((W // 2, info_top + 78), f"RANK: {rank}  •  {unit}", fill="#374151", anchor="mm")
        draw.text((W // 2, info_top + 100), "STATUS: VERIFIED & APPROVED", fill="#15803d", anchor="mm")

        # Bottom Border
        draw.rectangle([(0, H - 6), (W, H)], fill="#0c2014")

        # Save to file
        clean_filename = student_id.replace("/", "_").replace("\\", "_").replace(" ", "_")
        filepath = os.path.join(QR_DIR, f"{clean_filename}_qr_pass.png")
        badge.save(filepath, "PNG", quality=95)
        return filepath

    except Exception:
        return ""


# =============================================================================
# MODULE 1: CADET ENLISTMENT & PERSONNEL COMMAND
# =============================================================================
def create_cadet_account():
    """Streamlined cadet account creation with auto QR generation."""
    clear_screen()
    print("=" * 64)
    print("           ENLIST NEW CADET ACCOUNT (SUPABASE)")
    print("=" * 64)

    first_name = input("First Name                   : ").strip()
    if not first_name:
        print("[CANCELLED] First name cannot be empty.")
        input("\nPress Enter to return to menu...")
        return

    middle_name = input("Middle Name (Optional)       : ").strip()
    last_name = input("Last Name                    : ").strip()
    if not last_name:
        print("[CANCELLED] Last name cannot be empty.")
        input("\nPress Enter to return to menu...")
        return

    student_id = input("Student ID (e.g. 24-00123)   : ").strip()
    if not student_id:
        print("[CANCELLED] Student ID cannot be empty.")
        input("\nPress Enter to return to menu...")
        return

    email = input("Institutional / Active Email : ").strip().lower()
    if not email or "@" not in email:
        print("[CANCELLED] Valid email address is required.")
        input("\nPress Enter to return to menu...")
        return

    password = input("Password (min 8 chars, Enter for 'Cadet2026!'): ").strip()
    if not password:
        password = "Cadet2026!"
    elif len(password) < 8:
        print("[CANCELLED] Password must be at least 8 characters long.")
        input("\nPress Enter to return to menu...")
        return

    course = input("Degree Course (default: BSIT): ").strip() or "BS Information Technology"
    year_level = input("Year Level (1st/2nd/3rd/4th) : ").strip() or "1st Year"
    section = input("Class Section (default: 1-A) : ").strip() or "1-A"

    print("\nSelect Unit / Company:")
    print("  [1] Alpha Company")
    print("  [2] Bravo Company")
    print("  [3] Charlie Company")
    print("  [4] Medics Unit")
    print("  [5] GHQ (General Headquarters)")
    unit_choice = input("Enter choice (1-5, default: 1): ").strip()

    unit_map = {"1": "Alpha", "2": "Bravo", "3": "Charlie", "4": "Medics", "5": "GHQ"}
    company = unit_map.get(unit_choice, "Alpha")
    platoon = input("Platoon (default: 1st Platoon): ").strip() or "1st Platoon"
    phone = input("Contact Phone (Optional)     : ").strip()

    full_name = f"{first_name} {last_name}".strip()
    print("\nConnecting to Supabase...")

    try:
        # Step 1: Create Supabase Auth User
        auth_res = supabase.auth.sign_up(
            {
                "email": email,
                "password": password,
                "options": {
                    "data": {
                        "first_name": first_name,
                        "last_name": last_name,
                        "student_id": student_id,
                        "role": "cadet",
                    }
                },
            }
        )

        user_id = getattr(auth_res.user, "id", None)
        if not user_id:
            raise ValueError("Auth user created but no user ID was returned.")

        # Step 2: Insert into public.profiles
        profile_payload = {
            "user_id": user_id,
            "first_name": first_name,
            "middle_name": middle_name or None,
            "last_name": last_name,
            "student_id": student_id,
            "email": email,
            "phone": phone or None,
            "course": course,
            "year_level": year_level,
            "section": section,
            "company": company,
            "platoon": platoon,
            "date_of_birth": "2005-01-01",
            "address": "San Enrique, Iloilo",
            "role": "cadet",
            "status": "approved",
        }

        supabase.table("profiles").insert(profile_payload).execute()

        # Step 3: Generate Military QR Pass
        qr_file = generate_qr_pass(
            student_id=student_id,
            full_name=full_name,
            unit=f"{company} Company • {platoon}",
            rank="Cadet",
        )

        print("\n" + "*" * 64)
        print("  [SUCCESS] CADET ACCOUNT ENLISTED & APPROVED!")
        print("*" * 64)
        print(f"  Name        : {full_name}")
        print(f"  Student ID  : {student_id}")
        print(f"  Email       : {email}")
        print(f"  Unit        : {company} Company — {platoon}")
        print(f"  Password    : {password}")
        if qr_file:
            print(f"  QR Badge    : {qr_file}")
        print("*" * 64)

    except Exception as err:
        err_msg = str(err)
        if "already registered" in err_msg.lower():
            print(f"\n[REJECTED] Email '{email}' is already registered.")
        elif "duplicate key" in err_msg.lower() and "student_id" in err_msg.lower():
            print(f"\n[REJECTED] Student ID '{student_id}' is already registered.")
        else:
            print(f"\n[ERROR] Enlistment failed: {err_msg}")

    input("\nPress Enter to return to menu...")


def cadet_dossier_inspector():
    """View full 201 file details and allow updating unit/status."""
    clear_screen()
    print("=" * 64)
    print("            CADET 201 DOSSIER & PROFILE INSPECTOR")
    print("=" * 64)

    student_id = input("\nEnter Cadet Student ID to inspect: ").strip()
    if not student_id:
        return

    try:
        res = (
            supabase.table("profiles")
            .select("*")
            .eq("student_id", student_id)
            .maybeSingle()
            .execute()
        )

        c = res.data
        if not c:
            print(f"[NOT FOUND] No cadet registered with Student ID '{student_id}'.")
            input("\nPress Enter to return...")
            return

        full_name = f"{c.get('first_name')} {c.get('middle_name') or ''} {c.get('last_name')}".replace("  ", " ").strip()
        print("\n" + "-" * 60)
        print(f"  CADET 201 FILE: {full_name}")
        print("-" * 60)
        print(f"  Student ID       : {c.get('student_id')}")
        print(f"  Institutional Email: {c.get('email')}")
        print(f"  Phone Number     : {c.get('phone') or 'Not Provided'}")
        print(f"  Academic Course  : {c.get('course')} ({c.get('year_level')}) - Section {c.get('section')}")
        print(f"  Company / Unit   : {c.get('company', 'Alpha')} Company")
        print(f"  Platoon          : {c.get('platoon', '1st Platoon')}")
        print(f"  Account Status   : {str(c.get('status', 'approved')).upper()}")
        print(f"  Permanent Address: {c.get('address') or 'San Enrique, Iloilo'}")
        print(f"  Enlistment Date  : {c.get('created_at')}")
        print("-" * 60)

        # Quick Actions
        print("\nDossier Quick Actions:")
        print("  [1] Transfer Unit / Company")
        print("  [2] Toggle Status (Approve / Suspend)")
        print("  [3] Generate / Re-create QR Pass Badge")
        print("  [Enter] Return to Menu")

        act = input("\nSelect action (1-3): ").strip()
        if act == "1":
            print("\nSelect New Unit:")
            print("  [1] Alpha Company  [2] Bravo Company  [3] Charlie Company  [4] Medics  [5] GHQ")
            uc = input("Enter unit (1-5): ").strip()
            unit_map = {"1": "Alpha", "2": "Bravo", "3": "Charlie", "4": "Medics", "5": "GHQ"}
            new_comp = unit_map.get(uc, "Alpha")
            new_plat = input("New Platoon (default: 1st Platoon): ").strip() or "1st Platoon"

            supabase.table("profiles").update({"company": new_comp, "platoon": new_plat}).eq("id", c["id"]).execute()
            print(f"[OK] Cadet transferred to {new_comp} Company ({new_plat})!")
            generate_qr_pass(c["student_id"], full_name, f"{new_comp} Company • {new_plat}")

        elif act == "2":
            curr_st = c.get("status", "approved")
            new_st = "suspended" if curr_st == "approved" else "approved"
            supabase.table("profiles").update({"status": new_st}).eq("id", c["id"]).execute()
            print(f"[OK] Cadet status updated to: {new_st.upper()}!")

        elif act == "3":
            badge_path = generate_qr_pass(
                c["student_id"], full_name, f"{c.get('company', 'Alpha')} Company • {c.get('platoon', '1st Platoon')}"
            )
            print(f"[OK] QR ID Badge regenerated: {badge_path}")

    except Exception as e:
        print(f"[ERROR] Failed to inspect dossier: {e}")

    input("\nPress Enter to return...")


# =============================================================================
# MODULE 2: LIVE MULTI-UNIT COMPANY ROSTER & AUTO-REFRESH WATCH
# =============================================================================
def render_roster_table() -> int:
    """Renders the live company tables with active timestamp."""
    try:
        res = (
            supabase.table("profiles")
            .select("id, first_name, middle_name, last_name, student_id, email, course, year_level, section, company, platoon, status")
            .eq("role", "cadet")
            .order("last_name")
            .execute()
        )
        all_cadets = res.data or []
    except Exception as e:
        print(f"[ERROR] Failed to query Supabase: {e}")
        return 0

    clear_screen()
    now_str = datetime.datetime.now().strftime("%Y-%m-%d %I:%M:%S %p")
    print("=" * 78)
    print("                   LIVE CADET ROSTER BY COMPANY / UNIT")
    print(f"                 Refreshed from Supabase at: {now_str}")
    print("=" * 78)

    if not all_cadets:
        print("\nNo enrolled cadets found in the database.\n")
        return 0

    groups = {
        "ALPHA COMPANY": [],
        "BRAVO COMPANY": [],
        "CHARLIE COMPANY": [],
        "MEDICS UNIT": [],
        "GHQ (GENERAL HEADQUARTERS)": [],
        "OTHER UNITS / UNASSIGNED": [],
    }

    for c in all_cadets:
        comp = (c.get("company") or "").strip().lower()
        if "alpha" in comp:
            groups["ALPHA COMPANY"].append(c)
        elif "bravo" in comp:
            groups["BRAVO COMPANY"].append(c)
        elif "charlie" in comp:
            groups["CHARLIE COMPANY"].append(c)
        elif "medic" in comp:
            groups["MEDICS UNIT"].append(c)
        elif "ghq" in comp or "headquarter" in comp:
            groups["GHQ (GENERAL HEADQUARTERS)"].append(c)
        else:
            groups["OTHER UNITS / UNASSIGNED"].append(c)

    for group_name, members in groups.items():
        count = len(members)
        print(f"\n>>> [ {group_name} ]  --  Total: {count} Cadet{'s' if count != 1 else ''}")
        print("-" * 78)

        if count == 0:
            print("    (No cadets currently assigned to this unit)")
            continue

        print(f"    {'#':<3} | {'STUDENT ID':<13} | {'NAME':<24} | {'COURSE':<10} | {'PLATOON':<12} | {'STATUS'}")
        print("    " + "-" * 74)

        for idx, c in enumerate(members, start=1):
            name = f"{c.get('first_name', '')} {c.get('last_name', '')}".strip()
            student_id = c.get("student_id") or "N/A"
            course = c.get("course") or "BSIT"
            platoon = c.get("platoon") or "1st Plat."
            status = (c.get("status") or "APPROVED").upper()

            print(f"    {idx:<3} | {student_id:<13} | {name[:23]:<24} | {course[:9]:<10} | {platoon[:11]:<12} | {status}")

    print("\n" + "=" * 78)
    print(f"  TOTAL CADETS ENROLLED ACROSS ALL UNITS: {len(all_cadets)}")
    print("=" * 78)
    return len(all_cadets)


def list_all_cadets_grouped():
    """Interactive roster viewer with 1-click refresh and live auto-refresh watch."""
    render_roster_table()

    while True:
        print("\nRoster Controls:")
        print("  [r] Refresh Now     [a] Auto-Refresh (Live 4s Watch)     [q / Enter] Back to Menu")
        choice = input("\nSelect an action: ").strip().lower()

        if choice in ["q", "exit", "back", ""]:
            clear_screen()
            break

        elif choice == "r":
            render_roster_table()

        elif choice == "a":
            print("\nStarting Live Auto-Refresh Watch Mode...")
            time.sleep(1)

            last_count = -1
            try:
                while True:
                    current_count = render_roster_table()

                    if last_count != -1 and current_count > last_count:
                        new_diff = current_count - last_count
                        print(f"\n  *** [NEW REGISTRATION DETECTED: +{new_diff} NEW CADET(S) ENLISTED!] ***")

                    last_count = current_count
                    print("\n  [*] LIVE AUTO-REFRESH ACTIVE: Polling Supabase every 4 seconds...")
                    print("  Press 'q', [SPACE], or [ENTER] at any time to return to menu.\n")

                    stopped = False
                    if MSVCRT_AVAILABLE:
                        for _ in range(40):
                            if msvcrt.kbhit():
                                msvcrt.getch()
                                stopped = True
                                break
                            time.sleep(0.1)
                    else:
                        time.sleep(4)

                    if stopped:
                        clear_screen()
                        break

            except KeyboardInterrupt:
                clear_screen()
                break


# =============================================================================
# MODULE 3: CONTINUOUS CADET SEARCH CONSOLE
# =============================================================================
def search_cadets_loop():
    """Continuous search loop allowing repeated lookups until 'exit'."""
    clear_screen()
    while True:
        print("-" * 64)
        print("     CADET SEARCH CONSOLE (Type 'exit' to return to menu)")
        print("-" * 64)
        query = input("Enter Student ID, Name, or Unit: ").strip()

        if not query or query.lower() in ["exit", "q", "quit", "back", "done"]:
            clear_screen()
            break

        print(f"\nSearching database for '{query}'...")
        try:
            res = (
                supabase.table("profiles")
                .select("*")
                .eq("role", "cadet")
                .or_(f"student_id.ilike.%{query}%,last_name.ilike.%{query}%,first_name.ilike.%{query}%,company.ilike.%{query}%,email.ilike.%{query}%")
                .order("last_name")
                .execute()
            )

            matches = res.data or []
            if not matches:
                print(f"-> No cadets matching '{query}' found.\n")
                continue

            print(f"-> Found {len(matches)} matching cadet(s):")
            for idx, c in enumerate(matches, start=1):
                full_name = f"{c.get('first_name')} {c.get('middle_name') or ''} {c.get('last_name')}".replace("  ", " ").strip()
                student_id = c.get("student_id")
                unit = f"{c.get('company', 'Alpha')} Company"
                platoon = c.get("platoon", "1st Platoon")

                print(f"\n[{idx}] ----------------------------------------------------")
                print(f"  Name        : {full_name}")
                print(f"  Student ID  : {student_id}")
                print(f"  Unit        : {unit} • {platoon}")
                print(f"  Course      : {c.get('course')} ({c.get('year_level')}) - Section {c.get('section')}")
                print(f"  Email       : {c.get('email')}")
                print(f"  Phone       : {c.get('phone') or 'N/A'}")
                print(f"  Status      : {c.get('status', 'approved').upper()}")

                clean_id = student_id.replace("/", "_").replace("\\", "_").replace(" ", "_")
                qr_path = os.path.join(QR_DIR, f"{clean_id}_qr_pass.png")

                if os.path.exists(qr_path):
                    print(f"  QR Badge    : [EXISTS] {qr_path}")
                else:
                    gen_now = input("  QR Badge missing. Generate it now? (y/n): ").strip().lower()
                    if gen_now == "y":
                        created_badge = generate_qr_pass(student_id, full_name, f"{unit} • {platoon}")
                        print(f"  -> Generated: {created_badge}")

            print("---------------------------------------------------------\n")

        except Exception as e:
            print(f"[ERROR] Search failed: {e}\n")


# =============================================================================
# MODULE 4: BATCH MILITARY QR PASS GENERATOR
# =============================================================================
def batch_generate_all_qr():
    """Generates QR pass badges for EVERY approved cadet in Supabase."""
    clear_screen()
    print("=" * 64)
    print("        BATCH MILITARY QR PASS GENERATOR (ALL CADETS)")
    print("=" * 64)

    print("\nQuerying Supabase for all registered cadets...")
    try:
        res = (
            supabase.table("profiles")
            .select("student_id, first_name, middle_name, last_name, company, platoon")
            .eq("role", "cadet")
            .order("company")
            .execute()
        )

        cadets = res.data or []
        if not cadets:
            print("[INFO] No cadets found to generate passes.")
            input("\nPress Enter to return...")
            return

        print(f"Found {len(cadets)} cadets. Generating high-contrast QR pass badges...\n")
        generated_count = 0

        for idx, c in enumerate(cadets, start=1):
            student_id = c.get("student_id")
            if not student_id:
                continue

            full_name = f"{c.get('first_name', '')} {c.get('last_name', '')}".strip()
            unit = f"{c.get('company', 'Alpha')} Company • {c.get('platoon', '1st Platoon')}"

            badge_path = generate_qr_pass(student_id, full_name, unit)
            if badge_path:
                generated_count += 1
                print(f"  [{idx}/{len(cadets)}] Generated: {student_id} - {full_name}")

        print("\n" + "=" * 64)
        print(f"  [COMPLETED] Successfully generated {generated_count} QR Pass Badges!")
        print(f"  All badge images saved to: {os.path.abspath(QR_DIR)}")
        print("=" * 64)

    except Exception as e:
        print(f"[ERROR] Batch generation failed: {e}")

    input("\nPress Enter to return...")


# =============================================================================
# MODULE 5: FORMATION DRILL & MANUAL ATTENDANCE CONSOLE
# =============================================================================
def formation_attendance_console():
    """Quick manual terminal attendance check-in and drill session inspection."""
    clear_screen()
    print("=" * 64)
    print("        FORMATION DRILL & TERMINAL ATTENDANCE CONSOLE")
    print("=" * 64)

    print("\nFetching active drill formation sessions from Supabase...")
    try:
        sess_res = (
            supabase.table("attendance_sessions")
            .select("*")
            .order("created_at", desc=True)
            .limit(5)
            .execute()
        )
        sessions = sess_res.data or []

        if not sessions:
            print("[INFO] No attendance sessions found in database.")
            create_now = input("Would you like to open a new drill session now? (y/n): ").strip().lower()
            if create_now == "y":
                title = input("Enter Drill Session Title (e.g. Regular Instruction): ").strip() or "Regular Instruction"
                today = datetime.date.today().isoformat()
                new_s = supabase.table("attendance_sessions").insert({
                    "session_title": title,
                    "session_date": today,
                    "status": "open",
                }).execute()
                sessions = new_s.data or []
            else:
                input("\nPress Enter to return...")
                return

        print("\nRecent Formation Drill Sessions:")
        for idx, s in enumerate(sessions, start=1):
            st = s.get("status", "open").upper()
            print(f"  [{idx}] {s.get('session_title')} ({s.get('session_date')}) - [{st}]")

        active_session = sessions[0]
        print(f"\nActive Target Session: '{active_session.get('session_title')}' (ID: {active_session.get('id')})")

        print("\n--- FAST TERMINAL ATTENDANCE CHECK-IN ---")
        print("Type or scan Student IDs below to mark attendance.")
        print("(Type 'exit' or press Enter to finish)\n")

        while True:
            student_id = input("Scan / Enter Student ID: ").strip()
            if not student_id or student_id.lower() in ["exit", "q", "done"]:
                break

            # Find matching cadet profile
            prof = supabase.table("profiles").select("id, student_id, first_name, last_name, company").eq("student_id", student_id).maybeSingle().execute().data
            if not prof:
                print(f"  [X] No cadet found with Student ID '{student_id}'.")
                continue

            cadet_name = f"{prof.get('first_name')} {prof.get('last_name')}"

            # Check if record already exists for this session
            rec_check = (
                supabase.table("attendance_records")
                .select("id")
                .eq("session_id", active_session["id"])
                .eq("student_id", student_id)
                .maybeSingle()
                .execute()
            )

            if rec_check.data:
                print(f"  [!] ALREADY MARKED: {cadet_name} ({student_id}) is already checked in.")
            else:
                now_time = datetime.datetime.now().strftime("%H:%M:%S")
                supabase.table("attendance_records").insert({
                    "session_id": active_session["id"],
                    "student_id": student_id,
                    "cadet_name": cadet_name,
                    "status": "PRESENT",
                    "time_in": now_time,
                    "method": "MANUAL",
                }).execute()
                print(f"  [OK] PRESENT: {cadet_name} ({student_id}) checked in at {now_time}!")

    except Exception as e:
        print(f"[ERROR] Attendance console error: {e}")

    input("\nPress Enter to return...")


# =============================================================================
# MODULE 6: DATABASE HEALTH DIAGNOSTIC & LATENCY PING
# =============================================================================
def database_diagnostics():
    """Runs a complete connection test and reports table metrics."""
    clear_screen()
    print("=" * 64)
    print("            SUPABASE DATABASE HEALTH & DIAGNOSTICS")
    print("=" * 64)

    print("\nPinging Supabase Cloud endpoint...")
    t0 = time.time()
    try:
        cadet_count = supabase.table("profiles").select("*", count="exact").eq("role", "cadet").limit(1).execute().count
        latency_ms = round((time.time() - t0) * 1000)

        admin_count = supabase.table("profiles").select("*", count="exact").eq("role", "admin").limit(1).execute().count
        session_count = supabase.table("attendance_sessions").select("*", count="exact").limit(1).execute().count
        ann_count = supabase.table("announcements").select("*", count="exact").limit(1).execute().count
        post_count = supabase.table("posts").select("*", count="exact").limit(1).execute().count

        print("\nDiagnostic Results:")
        print(f"  Connection Status  : [ONLINE] Connected successfully")
        print(f"  Ping Latency       : {latency_ms} ms")
        print(f"  Total Cadets (201) : {cadet_count}")
        print(f"  Command Staff      : {admin_count}")
        print(f"  Drill Sessions     : {session_count}")
        print(f"  Live Announcements : {ann_count}")
        print(f"  Unit Dispatches    : {post_count}")
        print(f"  QR Pass Directory  : {os.path.abspath(QR_DIR)} ({len(os.listdir(QR_DIR))} files)")
        print("\n[HEALTHY] Database tables and public RLS access are functioning normally.")

    except Exception as e:
        print(f"\n[ERROR] Diagnostic check encountered an error: {e}")

    input("\nPress Enter to return...")


# =============================================================================
# MODULE 7: EXPORT BATTALION REPORTS (.CSV)
# =============================================================================
def export_battalion_reports():
    """Exports clean CSV ledgers for official battalion records."""
    clear_screen()
    print("=" * 64)
    print("              EXPORT BATTALION REPORTS (CSV)")
    print("=" * 64)

    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    out_file = f"cadet_roster_{timestamp}.csv"

    print("\nExporting complete cadet roster from Supabase...")
    try:
        res = (
            supabase.table("profiles")
            .select("student_id, first_name, middle_name, last_name, company, platoon, course, year_level, section, email, phone, status, created_at")
            .eq("role", "cadet")
            .order("company")
            .order("last_name")
            .execute()
        )

        cadets = res.data or []
        if not cadets:
            print("[INFO] No cadet records found to export.")
            input("\nPress Enter to return...")
            return

        with open(out_file, mode="w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=list(cadets[0].keys()))
            writer.writeheader()
            writer.writerows(cadets)

        print(f"\n[SUCCESS] Exported {len(cadets)} cadets into '{out_file}'!")
        print(f"File Location: {os.path.abspath(out_file)}")

    except Exception as e:
        print(f"[ERROR] Export failed: {e}")

    input("\nPress Enter to return...")


# =============================================================================
# MAIN EXECUTIVE COMMAND MENU
# =============================================================================
def main_menu():
    """Master executive console menu."""
    while True:
        clear_screen()
        print("=" * 64)
        print("    ROTCIMS EXECUTIVE COMMAND & OPERATIONS TOOLKIT")
        print("    San Enrique ROTC Unit • 604th CDC • 6RCDG ARESCOM")
        print("=" * 64)
        print("  [1] Create a Cadet Account (Enlist with Auto QR Badge)")
        print("  [2] Cadet 201 Dossier (View Details, Transfer Unit, Status)")
        print("  [3] Live Multi-Unit Company Roster (Auto-Refresh Watch)")
        print("  [4] Cadet Search Console (Continuous Interactive Loop)")
        print("  [5] Batch Generate Military QR Pass Badges (All Cadets)")
        print("  [6] Formation Drill & Terminal Attendance Check-In")
        print("  [7] Database Health Diagnostics & Latency Ping")
        print("  [8] Export Official Battalion Roster to CSV File")
        print("  [9] Exit")
        print("=" * 64)

        choice = input("\nSelect Command Option (1-9): ").strip()

        if choice == "1":
            create_cadet_account()
        elif choice == "2":
            cadet_dossier_inspector()
        elif choice == "3":
            list_all_cadets_grouped()
        elif choice == "4":
            search_cadets_loop()
        elif choice == "5":
            batch_generate_all_qr()
        elif choice == "6":
            formation_attendance_console()
        elif choice == "7":
            database_diagnostics()
        elif choice == "8":
            export_battalion_reports()
        elif choice == "9":
            clear_screen()
            print("\nROTCIMS Executive Toolkit Terminated. Dismissed!\n")
            break
        else:
            pass


if __name__ == "__main__":
    main_menu()


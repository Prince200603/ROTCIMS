"""
=============================================================================
FILE: sign_up.py
PROJECT: ROTCIMS — San Enrique ROTC Unit Management System
PURPOSE: Simplified Executive Python Cadet Manager for Supabase:
  1. Create a Cadet Account (with auto QR Code Badge)
  2. List All Enrolled Cadets (Grouped by Alpha, Bravo, Charlie, Medics, GHQ)
  3. Search Cadets (Continuous live search loop with easy exit)
  4. Generate / View Cadet QR Pass Badge
  5. Export Full Roster to CSV File
  6. Exit
=============================================================================
"""

import os
import sys
import csv
import time
import datetime
from supabase import create_client, Client

# Windows non-blocking keyboard input for auto-refresh watch mode
try:
    import msvcrt
    MSVCRT_AVAILABLE = True
except ImportError:
    MSVCRT_AVAILABLE = False

# Optional imports for QR badge generation
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

# Helper: Clear Terminal Screen (Removes all previous inputs and command prompt clutter)
def clear_screen():
    os.system("cls" if os.name == "nt" else "clear")

# Initialize Supabase Client
try:
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
except Exception as e:
    print(f"\n[ERROR] Failed to connect to Supabase: {e}")
    sys.exit(1)


# =============================================================================
# HELPER: GENERATE MILITARY QR CODE PASS (.PNG)
# =============================================================================
def generate_qr_pass(student_id: str, full_name: str, unit: str = "Alpha Company", rank: str = "Cadet") -> str:
    """
    Generates a printable, high-contrast military QR ID card saved as PNG.
    Encoded with the cadet's Student ID for instant attendance scanning.
    """
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

    except Exception as e:
        print(f"   [NOTICE] Could not generate QR badge: {e}")
        return ""


# =============================================================================
# OPTION 1: CREATE A CADET ACCOUNT
# =============================================================================
def create_cadet_account():
    """Collects input and registers a single cadet in Supabase Auth, Profiles, and Cadets."""
    clear_screen()
    print("=" * 60)
    print("              CREATE A CADET ACCOUNT")
    print("=" * 60)

    first_name = input("First Name                   : ").strip()
    if not first_name:
        print("[CANCELLED] First name cannot be empty.")
        return

    middle_name = input("Middle Name (Optional)       : ").strip()
    last_name = input("Last Name                    : ").strip()
    if not last_name:
        print("[CANCELLED] Last name cannot be empty.")
        return

    student_id = input("Student ID (e.g. 24-00123)   : ").strip()
    if not student_id:
        print("[CANCELLED] Student ID cannot be empty.")
        return

    email = input("Institutional / Active Email : ").strip().lower()
    if not email or "@" not in email:
        print("[CANCELLED] Valid email address is required.")
        return

    password = input("Password (min 8 chars, Enter for 'Cadet2026!'): ").strip()
    if not password:
        password = "Cadet2026!"
    elif len(password) < 8:
        print("[CANCELLED] Password must be at least 8 characters long.")
        return

    course = input("Course (default: BSIT)       : ").strip() or "BS Information Technology"
    year_level = input("Year Level (1st/2nd/3rd/4th) : ").strip() or "1st Year"
    section = input("Class Section (default: 1-A) : ").strip() or "1-A"

    # Quick selection for Company / Unit
    print("\nSelect Unit / Company:")
    print("  [1] Alpha Company")
    print("  [2] Bravo Company")
    print("  [3] Charlie Company")
    print("  [4] Medics Unit")
    print("  [5] GHQ (General Headquarters)")
    unit_choice = input("Enter choice (1-5, default: 1): ").strip()

    unit_map = {
        "1": "Alpha",
        "2": "Bravo",
        "3": "Charlie",
        "4": "Medics",
        "5": "GHQ",
    }
    company = unit_map.get(unit_choice, "Alpha")

    platoon = input("Platoon (default: 1st Platoon): ").strip() or "1st Platoon"
    phone = input("Contact Phone (Optional)     : ").strip()

    clean_email = email.strip().lower()
    clean_student_id = student_id.strip()
    full_name = f"{first_name.strip()} {last_name.strip()}"

    print("\nProcessing registration in Supabase...")

    try:
        # Step 1: Create Supabase Auth User
        auth_res = supabase.auth.sign_up(
            {
                "email": clean_email,
                "password": password,
                "options": {
                    "data": {
                        "first_name": first_name.strip(),
                        "last_name": last_name.strip(),
                        "student_id": clean_student_id,
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
            "first_name": first_name.strip(),
            "middle_name": middle_name.strip() if middle_name else None,
            "last_name": last_name.strip(),
            "student_id": clean_student_id,
            "email": clean_email,
            "phone": phone.strip() if phone else None,
            "course": course.strip(),
            "year_level": year_level.strip(),
            "section": section.strip(),
            "company": company,
            "platoon": platoon,
            "date_of_birth": "2005-01-01",
            "address": "San Enrique, Iloilo",
            "role": "cadet",
            "status": "approved",
        }

        prof_res = supabase.table("profiles").insert(profile_payload).execute()
        profile_id = prof_res.data[0].get("id") if prof_res.data else None

        # Step 3: Insert into public.cadets for QR Attendance
        if profile_id:
            try:
                supabase.table("cadets").insert(
                    {
                        "profile_id": profile_id,
                        "rotc_unit": f"{company} Company",
                        "rank": "Cadet",
                    }
                ).execute()
            except Exception:
                pass

        # Step 4: Auto-Generate Military QR Pass
        qr_file = generate_qr_pass(
            student_id=clean_student_id,
            full_name=full_name,
            unit=f"{company} Company • {platoon}",
            rank="Cadet",
        )

        print("\n" + "*" * 60)
        print("  SUCCESS: CADET ACCOUNT CREATED & APPROVED!")
        print("*" * 60)
        print(f"  Name        : {full_name}")
        print(f"  Student ID  : {clean_student_id}")
        print(f"  Email       : {clean_email}")
        print(f"  Unit        : {company} Company — {platoon}")
        print(f"  Password    : {password}")
        if qr_file:
            print(f"  QR Badge    : {qr_file}")
        print("*" * 60)

    except Exception as err:
        err_msg = str(err)
        if "already registered" in err_msg.lower():
            print(f"\n[REJECTED] Email '{clean_email}' is already registered.")
        elif "duplicate key" in err_msg.lower() and "student_id" in err_msg.lower():
            print(f"\n[REJECTED] Student ID '{clean_student_id}' is already assigned.")
        else:
            print(f"\n[ERROR] Account creation failed: {err_msg}")


# =============================================================================
# OPTION 2: LIST ALL ENROLLED CADETS (GROUPED BY COMPANY / UNIT)
# =============================================================================
def render_roster_table() -> int:
    """
    Fetches the live roster from Supabase, clears the screen, and renders
    ONLY the clean company tables with active timestamp and cadet count.
    """
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

    # Clear terminal screen to remove all previous prompts and cluttered commands
    clear_screen()

    now_str = datetime.datetime.now().strftime("%Y-%m-%d %I:%M:%S %p")
    print("=" * 78)
    print("                   LIVE CADET ROSTER BY COMPANY / UNIT")
    print(f"                 Refreshed from Supabase at: {now_str}")
    print("=" * 78)

    if not all_cadets:
        print("\nNo enrolled cadets found in the database.\n")
        return 0

    # Categorize cadets into specific company buckets
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

    # Print each unit group table cleanly
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
    """
    Clears the screen and displays only the company roster tables.
    Provides options for 1-click manual refresh or automated live watch mode.
    """
    render_roster_table()

    while True:
        print("\nRoster Controls:")
        print("  [r] Refresh Now     [a] Auto-Refresh (Live 4s Watch)     [q / Enter] Back to Menu")
        choice = input("\nSelect an action: ").strip().lower()

        if choice in ["q", "exit", "back", ""]:
            clear_screen()
            break

        elif choice == "r":
            # Clear screen and re-render fresh data
            render_roster_table()

        elif choice == "a":
            # Auto-Refresh Watch Mode: polls every 4s and clears the screen automatically
            print("\nStarting Live Auto-Refresh Watch Mode (every 4 seconds)...")
            time.sleep(1)

            last_count = -1
            try:
                while True:
                    current_count = render_roster_table()

                    # Highlight if a newly registered cadet was detected
                    if last_count != -1 and current_count > last_count:
                        new_diff = current_count - last_count
                        print(f"\n  *** [NEW REGISTRATION DETECTED: +{new_diff} NEW CADET(S) ENLISTED!] ***")

                    last_count = current_count

                    print("\n  ● LIVE AUTO-REFRESH ACTIVE: Polling Supabase every 4 seconds...")
                    print("  Press 'q', [SPACE], or [ENTER] at any time to return to menu.\n")

                    # Sleep 4 seconds while listening for any keypress to exit
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
                        print("[Auto-Refresh Stopped] Returning to menu...\n")
                        break

            except KeyboardInterrupt:
                clear_screen()
                print("\n[Auto-Refresh Stopped] Returning to menu...\n")
                break
        else:
            print("Invalid key. Type 'r' to refresh, 'a' for auto-refresh, or 'q' to go back.")


# =============================================================================
# OPTION 3: SEARCH CADETS (CONTINUOUS SEARCH LOOP WITH EASY EXIT)
# =============================================================================
def search_cadets_loop():
    """
    Search loop: allows continuous searching for cadets by Student ID, Name,
    Email, or Unit without exiting to the main menu each time.
    Type 'exit' or press Enter to return.
    """
    clear_screen()
    while True:
        print("-" * 60)
        print("   CADET SEARCH CONSOLE (Type 'exit' to return to menu)")
        print("-" * 60)
        query = input("Enter Student ID, Name, or Unit: ").strip()

        # Exit condition
        if not query or query.lower() in ["exit", "q", "quit", "back", "done"]:
            print("Exiting search console. Returning to main menu...\n")
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
                print(f"-> No cadets matching '{query}' found.")
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

                # Check if QR Badge exists
                clean_id = student_id.replace("/", "_").replace("\\", "_").replace(" ", "_")
                qr_path = os.path.join(QR_DIR, f"{clean_id}_qr_pass.png")

                if os.path.exists(qr_path):
                    print(f"  QR Badge    : [EXISTS] {qr_path}")
                else:
                    gen_now = input("  QR Badge missing. Generate it now? (y/n): ").strip().lower()
                    if gen_now == "y":
                        created_badge = generate_qr_pass(student_id, full_name, f"{unit} • {platoon}")
                        print(f"  -> Generated: {created_badge}")

            print("---------------------------------------------------------")

        except Exception as e:
            print(f"[ERROR] Search failed: {e}")


# =============================================================================
# OPTION 4: GENERATE / VIEW CADET QR CODE PASS BADGE
# =============================================================================
def generate_or_view_qr_pass():
    """Generates or opens the QR pass badge for a specific cadet."""
    student_id = input("\nEnter Cadet Student ID (e.g. 24-000001): ").strip()
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
            return

        full_name = f"{c.get('first_name')} {c.get('last_name')}".strip()
        unit = f"{c.get('company', 'Alpha')} Company • {c.get('platoon', '1st Platoon')}"

        clean_id = student_id.replace("/", "_").replace("\\", "_").replace(" ", "_")
        badge_path = os.path.join(QR_DIR, f"{clean_id}_qr_pass.png")

        print(f"\nGenerating military QR pass for {full_name} ({student_id})...")
        created = generate_qr_pass(student_id, full_name, unit)

        if created:
            print(f"[SUCCESS] QR ID Badge saved to: {os.path.abspath(created)}")
            # Attempt to open file in system default viewer
            try:
                if sys.platform.startswith("win"):
                    os.startfile(os.path.abspath(created))
            except Exception:
                pass
        else:
            print("[ERROR] Failed to generate QR badge.")

    except Exception as e:
        print(f"[ERROR] QR generation failed: {e}")


# =============================================================================
# OPTION 5: EXPORT FULL ROSTER TO CSV LEDGER
# =============================================================================
def export_roster_to_csv():
    """Exports all approved cadets into a clean, timestamped CSV ledger."""
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    out_file = f"cadet_roster_{timestamp}.csv"

    print("\nFetching latest cadet records from Supabase...")
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
            print("No cadet records found to export.")
            return

        with open(out_file, mode="w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=list(cadets[0].keys()))
            writer.writeheader()
            writer.writerows(cadets)

        print(f"\n[OK] Successfully exported {len(cadets)} cadets to '{out_file}'!")
        print(f"File path: {os.path.abspath(out_file)}")

    except Exception as e:
        print(f"[ERROR] Export failed: {e}")


# =============================================================================
# MAIN INTERACTIVE MENU (SIMPLIFIED & PRIORITIZED)
# =============================================================================
def main_menu():
    """Main terminal loop with clean, simple menu options."""
    while True:
        print("\n" + "=" * 54)
        print("         ROTCIMS CADET MANAGEMENT SYSTEM")
        print("=" * 54)
        print("1. Create a Cadet Account")
        print("2. List All Enrolled Cadets (Alpha, Bravo, Charlie, Medics, GHQ)")
        print("3. Search Cadets (Search Loop)")
        print("4. Generate / View Cadet QR Pass")
        print("5. Export Full Roster to CSV File")
        print("6. Exit")

        choice = input("\nSelect an option (1-6): ").strip()

        if choice == "1":
            create_cadet_account()
        elif choice == "2":
            list_all_cadets_grouped()
        elif choice == "3":
            search_cadets_loop()
        elif choice == "4":
            generate_or_view_qr_pass()
        elif choice == "5":
            export_roster_to_csv()
        elif choice == "6":
            print("\nExiting ROTCIMS Cadet Management. Dismissed!\n")
            break
        else:
            print("\nInvalid choice. Please select 1 through 6.")


if __name__ == "__main__":
    main_menu()

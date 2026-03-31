# Invoice Routes
from flask import Blueprint, request, jsonify
from supabase_client import get_supabase
from datetime import datetime
import re

invoices_bp = Blueprint("invoices", __name__)
supabase = get_supabase()

ITEM_COLUMNS = [
    "shirt",
    "skirt",
    "pant",
    "pina",
    "tie",
    "belt",
    "socks_house",
    "socks_school",
    "t_shirt",
    "track_pant",
    "blazer",
    "hair_band",
    "house_shoes",
    "school_shoes",
    "pt_suit",
    "sports_uniform",
    "school_bag",
]

ITEM_TO_STOCK_NAMES = {
    "shirt": ["shirt", "boy shirt", "girl shirt"],
    "skirt": ["skirt"],
    "pant": ["pant"],
    "pina": ["pina"],
    "tie": ["tie"],
    "belt": ["belt"],
    "socks_house": ["socks", "house socks", "socks house"],
    "socks_school": ["socks", "school socks", "socks school"],
    "t_shirt": ["t shirt", "t-shirt", "t_shirt"],
    "track_pant": ["track pant", "track_pant"],
    "blazer": ["blazer"],
    "hair_band": ["hair band", "hair_band"],
    "house_shoes": ["house shoes", "house_shoes"],
    "school_shoes": ["school shoes", "school_shoes", "shoes"],
    "pt_suit": ["pt suit", "pt_suit", "sports uniform"],
    "sports_uniform": ["sports uniform", "pt suit", "pt_suit"],
    "school_bag": ["school bag", "school_bag", "bag"],
}

ITEM_NAME_TO_DB_FIELD = {
    "boy_shirt": "shirt",
    "girl_shirt": "shirt",
    "shirt": "shirt",
    "skirt": "skirt",
    "pant": "pant",
    "pina": "pina",
    "tie": "tie",
    "belt": "belt",
    "socks": "socks_house",
    "socks_house": "socks_house",
    "socks_school": "socks_school",
    "t_shirt": "t_shirt",
    "track_pant": "track_pant",
    "blazer": "blazer",
    "hair_band": "hair_band",
    "house_shoes": "house_shoes",
    "school_shoes": "school_shoes",
    "shoes": "school_shoes",
    "pt_suit": "pt_suit",
    "sports_uniform": "sports_uniform",
    "school_bag": "school_bag",
    "bag": "school_bag",
}


def _resolve_students_table():
    candidates = ["students", "student", "samata_students", "samata_school_students"]
    for table_name in candidates:
        try:
            supabase.table(table_name).select("*").limit(1).execute()
            return table_name
        except Exception:
            continue
    return None


def _resolve_stock_table():
    # Keep multiple name variants to support historical typo variants in existing DBs.
    candidates = [
        "school_stocks",
        "stocks",
        "samata_school_unifrom_cost",
        "samata_schools_unifrom_cost",
        "samata_school_uniform_cost",
        "samata_schools_uniform_cost",
    ]
    for table_name in candidates:
        try:
            supabase.table(table_name).select("*").limit(1).execute()
            print(f"[INFO] Using pricing table: {table_name}")
            return table_name
        except Exception:
            continue
    print("[ERROR] No pricing table found")
    return None


def _normalize_token(value):
    return str(value or "").strip().lower()


def _to_float(value, default=0.0):
    try:
        return float(str(value).strip())
    except Exception:
        return float(default)


def _to_int(value, default=0):
    try:
        return int(float(str(value).strip()))
    except Exception:
        return int(default)


def _normalize_item_token(value):
    token = re.sub(r"[^a-z0-9]+", "_", str(value or "").strip().lower()).strip("_")
    return re.sub(r"_+", "_", token)


def _normalize_standard_token(value):
    text = str(value or "").strip()
    if not text:
        return ""
    match = re.search(r"\d+", text)
    if not match:
        return ""
    return str(int(match.group(0)))


def _normalize_size_token(value):
    token = _normalize_token(value)
    if token in ["", "-", "na", "n/a", "none"]:
        return ""
    return token


def _infer_item_db_field(item_name):
    token = _normalize_item_token(item_name)
    return ITEM_NAME_TO_DB_FIELD.get(token, token)


def _build_item_alias_tokens(item_name):
    item_token = _normalize_item_token(item_name)
    db_field = _infer_item_db_field(item_name)

    aliases = {item_token, _normalize_item_token(db_field)}
    for alias in ITEM_TO_STOCK_NAMES.get(db_field, [db_field]):
        aliases.add(_normalize_item_token(alias))

    if item_token in ["boy_shirt", "girl_shirt"]:
        aliases.add("shirt")

    return {a for a in aliases if a}


def _find_best_stock_row(stock_rows, item_name, student_std, student_gender, item_size):
    alias_tokens = _build_item_alias_tokens(item_name)
    if not alias_tokens:
        return None

    std_token = _normalize_standard_token(student_std)
    gender_token = _normalize_gender(student_gender)
    size_token = _normalize_size_token(item_size)

    best_row = None
    best_score = -1

    for row in stock_rows:
        row_item_token = _normalize_item_token(row.get("item") or row.get("Item") or "")
        if row_item_token not in alias_tokens:
            continue

        score = 10

        row_std_token = _normalize_standard_token(row.get("standard") or row.get("Standard") or "")
        if std_token and row_std_token == std_token:
            score += 8

        row_gender_token = _normalize_gender(row.get("gender") or row.get("Gender") or "")
        if gender_token and row_gender_token == gender_token:
            score += 4

        row_size_token = _normalize_size_token(row.get("size") or row.get("Size") or "")
        if size_token and row_size_token == size_token:
            score += 6

        if score > best_score:
            best_score = score
            best_row = row

    return best_row


def _apply_stock_delta(stock_table, stock_row, quantity_delta):
    current_stock = _to_int(stock_row.get("stock") or stock_row.get("Stock"), 0)
    next_stock = max(0, current_stock + _to_int(quantity_delta, 0))

    row_id = stock_row.get("id")
    if row_id:
        try:
            by_id_resp = supabase.table(stock_table).update({"stock": next_stock}).eq("id", row_id).execute()
            if by_id_resp.data:
                return True
        except Exception:
            pass

    row_item = stock_row.get("item") or stock_row.get("Item")
    if not row_item:
        return False

    try:
        query = supabase.table(stock_table).update({"stock": next_stock}).eq("item", row_item)

        school_id = stock_row.get("school_id")
        if school_id not in [None, ""]:
            query = query.eq("school_id", school_id)

        standard = stock_row.get("standard")
        if standard not in [None, ""]:
            query = query.eq("standard", standard)

        gender = stock_row.get("gender")
        if gender not in [None, ""]:
            query = query.eq("gender", gender)

        size = stock_row.get("size")
        if size not in [None, ""]:
            query = query.eq("size", size)

        fallback_resp = query.execute()
        return bool(fallback_resp.data)
    except Exception:
        return False


def _get_student_std_gender(student_id):
    student_std = ""
    student_gender = ""

    students_table = _resolve_students_table()
    if students_table and student_id:
        student_response = supabase.table(students_table).select("std, gender").eq("id", student_id).limit(1).execute()
        if student_response.data:
            student = student_response.data[0]
            student_std = student.get("std")
            student_gender = student.get("gender")

    return student_std, student_gender


def _recalculate_invoice_totals(invoice_id):
    items_response = supabase.table("invoice_items").select("quantity, unit_price").eq("invoice_id", invoice_id).execute()
    items = items_response.data or []

    subtotal = 0.0
    for line in items:
        subtotal += _to_float(line.get("quantity"), 0) * _to_float(line.get("unit_price"), 0)

    invoice_response = supabase.table("invoices").select("tax_amount").eq("id", invoice_id).limit(1).execute()
    tax_amount = 0.0
    if invoice_response.data:
        tax_amount = _to_float(invoice_response.data[0].get("tax_amount"), 0)

    total = round(subtotal + tax_amount, 2)
    subtotal = round(subtotal, 2)

    supabase.table("invoices").update({
        "subtotal": subtotal,
        "total": total,
    }).eq("id", invoice_id).execute()

    return subtotal, total


def _parse_item_value(raw_value):
    if raw_value is None:
        return 0, None

    text = str(raw_value).strip()
    if text == "":
        return 0, None

    token = text.lower()
    if token in ["-", "--", "na", "n/a", "none", "0", "0.0"]:
        return 0, None

    try:
        number_value = float(text)
        if number_value <= 0:
            return 0, None
        if number_value <= 10:
            return int(round(number_value)), None
        return 1, text
    except Exception:
        return 1, text


def _normalize_gender(value):
    token = _normalize_token(value)
    if token in ["male", "boy", "boys", "m"]:
        return "boy"
    if token in ["female", "girl", "girls", "f"]:
        return "girl"
    return ""


def _load_stock_rows_for_school(stock_table, school_id):
    try:
        return supabase.table(stock_table).select("*").eq("school_id", school_id).execute().data or []
    except Exception:
        return supabase.table(stock_table).select("*").execute().data or []


def _pick_price_for_item(stock_rows, item_col, student_std, student_gender, student_size):
    aliases = [_normalize_token(v) for v in ITEM_TO_STOCK_NAMES.get(item_col, [item_col])]
    std_token = _normalize_token(student_std)
    gender_token = _normalize_gender(student_gender)
    size_token = _normalize_token(student_size)

    def matches_alias(row_item):
        row_item_token = _normalize_token(row_item)
        return row_item_token in aliases

    candidates = []
    for row in stock_rows:
        row_item = row.get("item") or row.get("Item") or ""
        if not matches_alias(row_item):
            continue

        row_std = _normalize_token(row.get("standard") or row.get("Standard") or "")
        row_gender = _normalize_gender(row.get("gender") or row.get("Gender") or "")
        row_size = _normalize_token(row.get("size") or row.get("Size") or "")
        row_price = _to_float(row.get("price") or row.get("Price"), 0)

        if row_price <= 0:
            continue

        score = 0
        if std_token and row_std == std_token:
            score += 8
        if gender_token and row_gender == gender_token:
            score += 4
        if size_token and row_size == size_token:
            score += 6

        candidates.append((score, row_price))

    if not candidates:
        return 0.0

    candidates.sort(key=lambda x: x[0], reverse=True)
    return float(candidates[0][1])


def _item_col_to_label(item_col):
    return item_col.replace("_", " ").title()


def _build_lines_from_student_uniform(student_row):
    school_id = student_row.get("school_id")
    student_std = student_row.get("std")
    student_gender = student_row.get("gender")

    stock_table = _resolve_stock_table()
    stock_rows = _load_stock_rows_for_school(stock_table, school_id) if stock_table else []

    lines = []
    for item_col in ITEM_COLUMNS:
        qty, size = _parse_item_value(student_row.get(item_col))
        if qty <= 0:
            continue

        unit_price = _pick_price_for_item(
            stock_rows=stock_rows,
            item_col=item_col,
            student_std=student_std,
            student_gender=student_gender,
            student_size=size,
        )

        lines.append({
            "dress": _item_col_to_label(item_col),
            "quantity": qty,
            "size": size or "-",
            "unit_price": unit_price,
        })

    return lines

@invoices_bp.route("/invoices/school/<school_id>", methods=["GET"])
def get_invoices_by_school(school_id):
    """Get all invoices for a specific school"""
    try:
        try:
            response = supabase.table("invoices").select("*").eq("school_id", school_id).order("created_at", desc=True).execute()
            invoices = response.data if response.data else []
        except Exception as e:
            print(f"Invoices table lookup skipped: {str(e)}")
            invoices = []

        student_ids = [row.get("student_id") for row in invoices if row.get("student_id")]
        student_map = {}
        students_table = _resolve_students_table()
        if student_ids and students_table:
            students_response = supabase.table(students_table).select("id, student_name").in_("id", student_ids).execute()
            student_map = {row.get("id"): row.get("student_name") for row in (students_response.data or [])}

        school_name = None
        school_response = supabase.table("schools").select("school_name").eq("id", school_id).limit(1).execute()
        if school_response.data:
            school_name = school_response.data[0].get("school_name")

        enriched = []
        for row in invoices:
            item = dict(row)
            item["student_name"] = student_map.get(row.get("student_id"))
            item["school_name"] = school_name
            enriched.append(item)

        return jsonify({
            "data": enriched
        }), 200
    except Exception as e:
        print(f"Get invoices error: {str(e)}")
        return jsonify({"message": f"Server error: {str(e)}"}), 500

@invoices_bp.route("/invoices", methods=["POST"])
def create_invoice():
    """
    Create a new invoice
    Expected payload: { student_id, school_id, status }
    """
    try:
        data = request.get_json(silent=True) or {}
        
        student_id = data.get("student_id")
        school_id = data.get("school_id")
        status = data.get("status", "Draft").strip()
        payment_mode = data.get("payment_mode", "cash").lower().strip()
        items = data.get("items") if isinstance(data.get("items"), list) else []
        
        # Validate payment mode
        if payment_mode not in ["cash", "online"]:
            payment_mode = "cash"
        
        if not student_id:
            return jsonify({"message": "Student ID is required"}), 400

        if not school_id:
            students_table = _resolve_students_table()
            if not students_table:
                return jsonify({"message": "Students table not found in database"}), 500

            student_response = supabase.table(students_table).select("school_id").eq("id", student_id).limit(1).execute()
            if not student_response.data:
                return jsonify({"message": "Student not found"}), 404
            school_id = student_response.data[0].get("school_id")

        if not school_id:
            return jsonify({"message": "School ID is required"}), 400
        
        if status not in ["Draft", "Paid"]:
            status = "Draft"
        
        # Generate invoice number
        invoice_number = f"INV-{datetime.now().strftime('%Y%m%d%H%M%S')}"

        normalized_items = []
        total = 0.0
        for raw in items:
            item_name = str(raw.get("item_name") or raw.get("dress") or "").strip()
            quantity = int(raw.get("quantity") or 0)
            size = str(raw.get("size") or "").strip() or None
            unit_price = float(raw.get("unit_price") or 0)

            if not item_name or quantity <= 0:
                continue

            normalized_items.append({
                "item_name": item_name,
                "quantity": quantity,
                "size": size,
                "unit_price": unit_price,
            })
            total += (quantity * unit_price)
        
        tax_percent = float(data.get("tax_percent") or 0)
        tax_amount = float(data.get("tax_amount") or 0)
        subtotal = round(total, 2)
        grand_total = round(subtotal + tax_amount, 2)

        insert_response = supabase.table("invoices").insert({
            "student_id": student_id,
            "school_id": school_id,
            "status": status,
            "payment_mode": payment_mode,
            "invoice_number": invoice_number,
            "subtotal": subtotal,
            "tax_percent": tax_percent,
            "tax_amount": tax_amount,
            "total": grand_total
        }).execute()
        
        if not insert_response.data:
            return jsonify({"message": "Failed to create invoice"}), 500
        
        invoice = insert_response.data[0]
        invoice_items_payload = []
        if normalized_items:
            for line in normalized_items:
                invoice_items_payload.append({
                    "invoice_id": invoice.get("id"),
                    "item_name": line["item_name"],
                    "quantity": line["quantity"],
                    "size": line["size"],
                    "unit_price": line["unit_price"],
                })
            supabase.table("invoice_items").insert(invoice_items_payload).execute()

        response_items = [{
            "dress": line["item_name"],
            "quantity": line["quantity"],
            "size": line["size"] or "-",
            "unit_price": line["unit_price"],
        } for line in normalized_items]

        return jsonify({
            "message": "Invoice created successfully",
            "data": [invoice],
            "invoice": {"items": response_items}
        }), 201
        
    except Exception as e:
        print(f"Create invoice error: {str(e)}")
        return jsonify({"message": f"Server error: {str(e)}"}), 500

@invoices_bp.route("/create-invoice/<student_id>", methods=["GET"])
def get_invoice_draft(student_id):
    """Get invoice draft for a student"""
    try:
        # Always compute fresh pricing from the uniform cost table for this student.
        students_table = _resolve_students_table()
        if students_table:
            student_response = supabase.table(students_table).select("*").eq("id", student_id).limit(1).execute()
            if student_response.data:
                auto_lines = _build_lines_from_student_uniform(student_response.data[0])
                return jsonify({"items": auto_lines}), 200

        # Fallback only when student row cannot be resolved.
        response = supabase.table("invoices").select("*").eq("student_id", student_id).order("created_at", desc=True).limit(1).execute()
        if not response.data:
            return jsonify({"items": []}), 200

        invoice = response.data[0]
        lines = []
        items_response = supabase.table("invoice_items").select("*").eq("invoice_id", invoice.get("id")).execute()
        for line in (items_response.data if items_response.data else []):
            lines.append({
                "dress": line.get("item_name") or line.get("dress") or "",
                "quantity": line.get("quantity") or 0,
                "size": line.get("size") or "-",
                "unit_price": line.get("unit_price") or 0,
            })

        return jsonify({"items": lines}), 200

    except Exception as e:
        print(f"Get invoice draft error: {str(e)}")
        return jsonify({"items": []}), 200

@invoices_bp.route("/invoices/<invoice_id>", methods=["GET"])
def get_invoice(invoice_id):
    """Get a specific invoice by ID"""
    try:
        response = supabase.table("invoices").select("*").eq("id", invoice_id).execute()
        
        if not response.data or len(response.data) == 0:
            return jsonify({"message": "Invoice not found"}), 404
        
        return jsonify(response.data[0]), 200
        
    except Exception as e:
        print(f"Get invoice error: {str(e)}")
        return jsonify({"message": f"Server error: {str(e)}"}), 500

@invoices_bp.route("/invoices/<invoice_id>/details", methods=["GET"])
def get_invoice_details(invoice_id):
    """Get invoice with related line items and student details"""
    try:
        invoice_response = supabase.table("invoices").select("*").eq("id", invoice_id).limit(1).execute()
        if not invoice_response.data:
            return jsonify({"message": "Invoice not found"}), 404

        invoice = invoice_response.data[0]

        items_response = supabase.table("invoice_items").select("*").eq("invoice_id", invoice_id).execute()
        items = items_response.data or []

        student = None
        student_id = invoice.get("student_id")
        students_table = _resolve_students_table()
        if student_id and students_table:
            student_response = supabase.table(students_table).select("*").eq("id", student_id).limit(1).execute()
            if student_response.data:
                student = student_response.data[0]

        school_name = None
        school_id = invoice.get("school_id")
        if school_id:
            school_response = supabase.table("schools").select("school_name").eq("id", school_id).limit(1).execute()
            if school_response.data:
                school_name = school_response.data[0].get("school_name")

        return jsonify({
            "invoice": invoice,
            "items": items,
            "student": student,
            "school_name": school_name,
        }), 200
    except Exception as e:
        print(f"Get invoice details error: {str(e)}")
        return jsonify({"message": f"Server error: {str(e)}"}), 500


@invoices_bp.route("/invoices/<invoice_id>", methods=["DELETE"])
def delete_invoice(invoice_id):
    """Delete an invoice and restore sold quantities back into stock for paid invoices"""
    try:
        invoice_response = supabase.table("invoices").select("*").eq("id", invoice_id).limit(1).execute()
        if not invoice_response.data:
            return jsonify({"message": "Invoice not found"}), 404

        invoice = invoice_response.data[0]
        invoice_status = _normalize_token(invoice.get("status"))

        items_response = supabase.table("invoice_items").select("*").eq("invoice_id", invoice_id).execute()
        invoice_items = items_response.data or []

        restored_lines = 0
        restored_quantity = 0

        # Only paid invoices affect inventory; drafts are just removed.
        if invoice_status == "paid" and invoice_items:
            stock_table = _resolve_stock_table()
            school_id = invoice.get("school_id")
            stock_rows = _load_stock_rows_for_school(stock_table, school_id) if stock_table else []
            student_std, student_gender = _get_student_std_gender(invoice.get("student_id"))

            for line in invoice_items:
                item_name = line.get("item_name") or line.get("dress") or ""
                quantity = _to_int(line.get("quantity"), 0)
                size = line.get("size")

                if not item_name or quantity <= 0:
                    continue

                target_row = _find_best_stock_row(
                    stock_rows=stock_rows,
                    item_name=item_name,
                    student_std=student_std,
                    student_gender=student_gender,
                    item_size=size,
                )

                if not target_row:
                    continue

                if _apply_stock_delta(stock_table, target_row, quantity):
                    target_row["stock"] = _to_int(target_row.get("stock"), 0) + quantity
                    restored_lines += 1
                    restored_quantity += quantity

        delete_response = supabase.table("invoices").delete().eq("id", invoice_id).execute()
        if not delete_response.data:
            return jsonify({"message": "Invoice not found or delete failed"}), 404

        return jsonify({
            "message": "Invoice deleted successfully",
            "restored_lines": restored_lines,
            "restored_quantity": restored_quantity,
        }), 200

    except Exception as e:
        print(f"Delete invoice error: {str(e)}")
        return jsonify({"message": f"Server error: {str(e)}"}), 500


@invoices_bp.route("/invoices/<invoice_id>/return-item", methods=["POST"])
def return_invoice_item(invoice_id):
    """Return a single invoice item, restore stock, and auto-delete invoice if no items remain."""
    try:
        data = request.get_json(silent=True) or {}
        invoice_item_id = data.get("invoice_item_id")

        if not invoice_item_id:
            return jsonify({"message": "invoice_item_id is required"}), 400

        invoice_response = supabase.table("invoices").select("*").eq("id", invoice_id).limit(1).execute()
        if not invoice_response.data:
            return jsonify({"message": "Invoice not found"}), 404

        invoice = invoice_response.data[0]

        item_response = (
            supabase
            .table("invoice_items")
            .select("*")
            .eq("id", invoice_item_id)
            .eq("invoice_id", invoice_id)
            .limit(1)
            .execute()
        )
        if not item_response.data:
            return jsonify({"message": "Invoice item not found"}), 404

        line = item_response.data[0]
        item_name = line.get("item_name") or line.get("dress") or ""
        quantity = _to_int(line.get("quantity"), 0)
        size = line.get("size")

        if quantity <= 0 or not item_name:
            return jsonify({"message": "Invalid invoice item"}), 400

        stock_table = _resolve_stock_table()
        if not stock_table:
            return jsonify({"message": "No stock table found for inventory restore"}), 500

        school_id = invoice.get("school_id")
        stock_rows = _load_stock_rows_for_school(stock_table, school_id) if stock_table else []
        student_std, student_gender = _get_student_std_gender(invoice.get("student_id"))

        target_row = _find_best_stock_row(
            stock_rows=stock_rows,
            item_name=item_name,
            student_std=student_std,
            student_gender=student_gender,
            item_size=size,
        )

        if not target_row:
            return jsonify({"message": "Matching stock row not found for returned item"}), 400

        if not _apply_stock_delta(stock_table, target_row, quantity):
            return jsonify({"message": "Failed to restore stock for returned item"}), 500

        delete_item_resp = supabase.table("invoice_items").delete().eq("id", invoice_item_id).eq("invoice_id", invoice_id).execute()
        if not delete_item_resp.data:
            return jsonify({"message": "Failed to return invoice item"}), 500

        remaining_items_resp = supabase.table("invoice_items").select("id").eq("invoice_id", invoice_id).execute()
        remaining_items = remaining_items_resp.data or []

        if not remaining_items:
            delete_invoice_resp = supabase.table("invoices").delete().eq("id", invoice_id).execute()
            if not delete_invoice_resp.data:
                return jsonify({"message": "Item returned but failed to delete empty invoice"}), 500

            return jsonify({
                "message": "Item returned and invoice deleted successfully",
                "invoice_deleted": True,
                "restored_quantity": quantity,
            }), 200

        subtotal, total = _recalculate_invoice_totals(invoice_id)
        return jsonify({
            "message": "Item returned successfully",
            "invoice_deleted": False,
            "restored_quantity": quantity,
            "subtotal": subtotal,
            "total": total,
        }), 200

    except Exception as e:
        print(f"Return invoice item error: {str(e)}")
        return jsonify({"message": f"Server error: {str(e)}"}), 500

@invoices_bp.route("/invoices/<invoice_id>", methods=["PUT"])
def update_invoice(invoice_id):
    """Update an invoice"""
    try:
        data = request.get_json(silent=True) or {}
        
        update_payload = {}
        if "status" in data:
            update_payload["status"] = data.get("status")
        if "total" in data:
            update_payload["total"] = data.get("total")
        
        if not update_payload:
            return jsonify({"message": "No fields to update"}), 400
        
        update_response = supabase.table("invoices").update(update_payload).eq("id", invoice_id).execute()
        
        if not update_response.data:
            return jsonify({"message": "Invoice not found or update failed"}), 404
        
        return jsonify({
            "message": "Invoice updated successfully",
            "data": update_response.data[0]
        }), 200
        
    except Exception as e:
        print(f"Update invoice error: {str(e)}")
        return jsonify({"message": f"Server error: {str(e)}"}), 500

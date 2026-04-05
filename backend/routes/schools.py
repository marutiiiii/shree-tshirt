# School Routes
import csv
import io
import re
from collections import defaultdict
from flask import Blueprint, request, jsonify
from supabase_client import get_supabase

schools_bp = Blueprint("schools", __name__)
supabase = get_supabase()


def _normalize_gender(value):
    token = str(value or "").strip().lower()
    if token in ["boy", "boys", "male", "m"]:
        return "boys"
    if token in ["girl", "girls", "female", "f"]:
        return "girls"
    return "default"


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


def _clean_item_name(value):
    raw = str(value or "").strip()
    cleaned = re.sub(r"\s+", " ", raw)
    cleaned = re.sub(r"^(boy|boys|girl|girls|male|female)\s+", "", cleaned, flags=re.IGNORECASE)
    cleaned = cleaned.strip() or raw
    if cleaned.lower() == "rubber band":
        return "Hair Band"
    return cleaned


def _infer_db_field(item_name):
    token = re.sub(r"[^a-z0-9]+", "_", str(item_name or "").strip().lower()).strip("_")
    mapping = {
        "boy_shirt": "shirt",
        "girl_shirt": "shirt",
        "shirt": "shirt",
        "pant": "pant",
        "pina": "pina",
        "t_shirt": "t_shirt",
        "pt_suit": "sports_uniform",
        "track_pant": "track_pant",
        "tie": "tie",
        "belt": "belt",
        "socks": "socks_house",
        "shoes": "school_shoes",
        "school_shoes": "school_shoes",
        "house_shoes": "house_shoes",
        "blazer": "blazer",
        "school_bag": "school_bag",
        "hair_band": "hair_band",
        "hair_belt": "hair_belt",
        "pt_socks": "pt_socks",
    }
    return mapping.get(token, token or "item")


def _read_csv_file(file_obj):
    raw = file_obj.read()
    if isinstance(raw, str):
        text = raw
    else:
        try:
            text = raw.decode("utf-8-sig")
        except Exception:
            text = raw.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))
    rows = [row for row in reader if row]
    return rows


def _build_catalog_rows(price_rows, school_id):
    grouped = {}

    for row in price_rows:
        standard = str(row.get("Standard") or row.get("standard") or "").strip()
        item_raw = row.get("Item") or row.get("item") or ""
        gender = _normalize_gender(row.get("Gender") or row.get("gender"))
        size = str(row.get("size") or row.get("Size") or row.get("SIZE") or "").strip()
        price = _to_float(row.get("Price") or row.get("price"), 0.0)

        if not item_raw:
            continue

        item_name = _clean_item_name(item_raw)
        item_token = item_name.lower()
        
        # Skip Pinafore - only Pina is allowed
        if "pinafore" in item_token:
            continue
        
        display_name = item_name.title()

        # Keep shirt split by gender so UI can show gender-correct pricing for shirt.
        if item_token == "shirt" and gender in ["boys", "girls"]:
            display_name = "Boy Shirt" if gender == "boys" else "Girl Shirt"
            group_key = f"{gender}_shirt"
        else:
            group_key = item_token

        if group_key not in grouped:
            grouped[group_key] = {
                "school_id": school_id,
                "item_name": display_name,
                "db_field": _infer_db_field(display_name),
                "sizes": set(),
                "price_map": {},
                "standard_price_map": {},
                "default_prices": [],
            }

        entry = grouped[group_key]
        if size:
            entry["sizes"].add(size)
            if size not in entry["price_map"]:
                entry["price_map"][size] = {}
            entry["price_map"][size][gender] = price

        if standard and size:
            if standard not in entry["standard_price_map"]:
                entry["standard_price_map"][standard] = {}
            if size not in entry["standard_price_map"][standard]:
                entry["standard_price_map"][standard][size] = {}
            entry["standard_price_map"][standard][size][gender] = price

        if price > 0:
            entry["default_prices"].append(price)

    catalog_rows = []
    for value in grouped.values():
        defaults = value.pop("default_prices", [])
        sizes = sorted(list(value["sizes"]), key=lambda x: str(x))
        value["sizes"] = sizes if sizes else ["XS", "S", "M", "L", "XL"]
        value["default_price"] = round((sum(defaults) / len(defaults)), 2) if defaults else 0
        catalog_rows.append(value)

    return catalog_rows


def _build_stock_rows(price_rows, school_id):
    stock_rows = []
    for row in price_rows:
        standard = str(row.get("Standard") or row.get("standard") or "").strip()
        item = str(row.get("Item") or row.get("item") or "").strip()
        gender = str(row.get("Gender") or row.get("gender") or "").strip()
        size = str(row.get("size") or row.get("Size") or "").strip()
        price = _to_float(row.get("Price") or row.get("price"), 0.0)
        stock = _to_int(row.get("Stock") or row.get("stock"), 0)

        if not item:
            continue

        stock_rows.append({
            "school_id": school_id,
            "standard": standard,
            "item": item,
            "gender": gender,
            "size": size,
            "price": price,
            "stock": stock,
        })

    return stock_rows


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


def _resolve_students_table():
    candidates = ["students", "student", "samata_students", "samata_school_students"]
    for table_name in candidates:
        try:
            supabase.table(table_name).select("*").limit(1).execute()
            return table_name
        except Exception:
            continue
    return None


def _normalize_item_token(value):
    token = re.sub(r"[^a-z0-9]+", "_", str(value or "").strip().lower()).strip("_")
    return re.sub(r"_+", "_", token)


def _normalize_standard(value):
    text = str(value or "").strip()
    if not text:
        return ""
    match = re.search(r"\d+", text)
    if not match:
        return ""
    try:
        return str(int(match.group(0)))
    except Exception:
        return ""


def _chunked(values, size=200):
    for i in range(0, len(values), size):
        yield values[i:i + size]


def _insert_rows_in_chunks(table_name, rows, chunk_size=500):
    if not rows:
        return
    for i in range(0, len(rows), chunk_size):
        supabase.table(table_name).insert(rows[i:i + chunk_size]).execute()

@schools_bp.route("/schools", methods=["GET"])
def get_schools():
    """Get all schools"""
    try:
        response = supabase.table("schools").select("*").execute()
        return jsonify({
            "data": response.data if response.data else [],
            "count": len(response.data) if response.data else 0
        }), 200
    except Exception as e:
        print(f"Get schools error: {str(e)}")
        return jsonify({"message": f"Server error: {str(e)}"}), 500

@schools_bp.route("/schools", methods=["POST"])
def create_school():
    """
    Create a new school
    Expected payload: { school_name, address, contact_person, contact_person_number, academic_year }
    """
    try:
        data = request.get_json(silent=True) if request.is_json else request.form.to_dict()
        data = data or {}
        
        school_name = data.get("school_name", "").strip()
        address = data.get("address", "").strip()
        contact_person = data.get("contact_person", "").strip()
        contact_person_number = data.get("contact_person_number", "").strip()
        academic_year = data.get("academic_year", "2024-2025").strip()
        
        if not school_name:
            return jsonify({"message": "School name is required"}), 400
        
        insert_response = supabase.table("schools").insert({
            "school_name": school_name,
            "address": address,
            "contact_person": contact_person,
            "contact_person_number": contact_person_number,
            "academic_year": academic_year
        }).execute()
        
        if not insert_response.data:
            return jsonify({"message": "Failed to create school"}), 500

        school = insert_response.data[0]
        file_obj = request.files.get("file")

        if file_obj:
            filename = str(file_obj.filename or "").lower()
            if not filename.endswith(".csv"):
                return jsonify({
                    "message": "School created, but pricing import supports CSV only. Please upload a .csv file."
                }), 201

            rows = _read_csv_file(file_obj)
            stock_rows = _build_stock_rows(rows, school.get("id"))
            stock_table = _resolve_stock_table()
            if stock_rows and stock_table:
                try:
                    supabase.table(stock_table).delete().eq("school_id", school.get("id")).execute()
                    _insert_rows_in_chunks(stock_table, stock_rows)
                except Exception:
                    # Fallback for legacy tables that do not include school_id.
                    bare_rows = [{k: v for k, v in row.items() if k != "school_id"} for row in stock_rows]
                    _insert_rows_in_chunks(stock_table, bare_rows)
        
        return jsonify({
            "message": "School added successfully",
            "data": school
        }), 201
        
    except Exception as e:
        print(f"Create school error: {str(e)}")
        return jsonify({"message": f"Server error: {str(e)}"}), 500

@schools_bp.route("/schools/<school_id>", methods=["GET"])
def get_school(school_id):
    """Get a specific school by ID"""
    try:
        response = supabase.table("schools").select("*").eq("id", school_id).execute()
        
        if not response.data or len(response.data) == 0:
            return jsonify({"message": "School not found"}), 404
        
        return jsonify({
            "data": response.data[0]
        }), 200
        
    except Exception as e:
        print(f"Get school error: {str(e)}")
        return jsonify({"message": f"Server error: {str(e)}"}), 500


@schools_bp.route("/uniform-catalog/<school_id>", methods=["GET"])
def get_uniform_catalog(school_id):
    """Get uniform catalog for a school"""
    try:
        items = []
        stock_table = _resolve_stock_table()
        if stock_table:
            try:
                stock_rows = supabase.table(stock_table).select("*").eq("school_id", school_id).execute().data or []
            except Exception:
                stock_rows = supabase.table(stock_table).select("*").execute().data or []
            items = _build_catalog_rows(stock_rows, school_id)

        return jsonify({"items": items}), 200
    except Exception as e:
        print(f"Get uniform catalog error: {str(e)}")
        return jsonify({"message": f"Server error: {str(e)}", "items": []}), 500


@schools_bp.route("/stocks/upload", methods=["POST"])
def upload_stocks():
    """Upload stock CSV and store records in the stock table"""
    try:
        school_id = str(request.form.get("school_id", "")).strip()
        file_obj = request.files.get("file")

        if not school_id:
            return jsonify({"success": False, "message": "school_id is required"}), 400
        if not file_obj:
            return jsonify({"success": False, "message": "Stock file is required"}), 400

        filename = str(file_obj.filename or "").lower()
        if not filename.endswith(".csv"):
            return jsonify({"success": False, "message": "Stock upload supports CSV only"}), 400

        rows = _read_csv_file(file_obj)
        stock_rows = _build_stock_rows(rows, school_id)
        stock_table = _resolve_stock_table()

        if not stock_table:
            return jsonify({
                "success": False,
                "message": "No stock table found. Create samata_school_uniform_cost in Supabase."
            }), 500

        try:
            supabase.table(stock_table).delete().eq("school_id", school_id).execute()
            _insert_rows_in_chunks(stock_table, stock_rows)
        except Exception:
            bare_rows = [{k: v for k, v in row.items() if k != "school_id"} for row in stock_rows]
            _insert_rows_in_chunks(stock_table, bare_rows)

        return jsonify({
            "success": True,
            "message": "Stocks uploaded successfully",
            "count": len(stock_rows)
        }), 200
    except Exception as e:
        print(f"Upload stocks error: {str(e)}")
        return jsonify({"success": False, "message": f"Server error: {str(e)}"}), 500


@schools_bp.route("/stocks", methods=["GET"])
def get_stocks():
    """Get stock rows for a school"""
    try:
        school_id = str(request.args.get("school_id", "")).strip()
        stock_table = _resolve_stock_table()

        if not stock_table:
            return jsonify({"success": True, "stocks": []}), 200

        if school_id:
            try:
                response = supabase.table(stock_table).select("*").eq("school_id", school_id).execute()
            except Exception:
                response = supabase.table(stock_table).select("*").execute()
        else:
            response = supabase.table(stock_table).select("*").execute()

        rows = response.data if response.data else []
        normalized = []
        for row in rows:
            normalized.append({
                "standard": row.get("standard") or row.get("Standard") or "",
                "item": row.get("item") or row.get("Item") or "",
                "gender": row.get("gender") or row.get("Gender") or "",
                "size": row.get("size") or row.get("Size") or "",
                "price": _to_float(row.get("price") or row.get("Price"), 0),
                "stock": _to_int(row.get("stock") or row.get("Stock"), 0),
            })

        return jsonify({"success": True, "stocks": normalized}), 200
    except Exception as e:
        print(f"Get stocks error: {str(e)}")
        return jsonify({"success": False, "stocks": [], "message": f"Server error: {str(e)}"}), 500


@schools_bp.route("/stocks/total-sold-report", methods=["GET"])
def get_total_sold_report():
    """Get standard-wise sold quantity matrix for products present in school stock table."""
    try:
        school_id = str(request.args.get("school_id", "")).strip()
        if not school_id:
            return jsonify({"success": False, "message": "school_id is required", "columns": [], "rows": []}), 400

        stock_table = _resolve_stock_table()
        if not stock_table:
            empty_rows = [{"standard": str(i), "total": 0} for i in range(1, 11)]
            return jsonify({"success": True, "columns": [], "rows": empty_rows}), 200

        try:
            stock_rows = supabase.table(stock_table).select("item, school_id").eq("school_id", school_id).execute().data or []
        except Exception:
            stock_rows = supabase.table(stock_table).select("item, school_id").execute().data or []
            stock_rows = [row for row in stock_rows if str(row.get("school_id", "")).strip() in ["", school_id]]

        product_tokens = sorted({
            _normalize_item_token(row.get("item"))
            for row in stock_rows
            if _normalize_item_token(row.get("item"))
        })

        rows_out = []
        sold_by_standard = {str(i): defaultdict(int) for i in range(1, 11)}

        invoice_response = supabase.table("invoices").select("id, student_id, status").eq("school_id", school_id).execute()
        invoices = invoice_response.data or []
        paid_invoices = [inv for inv in invoices if str(inv.get("status") or "").strip().lower() == "paid"]

        invoice_ids = [str(inv.get("id")).strip() for inv in paid_invoices if inv.get("id") is not None]
        student_ids = list({str(inv.get("student_id")).strip() for inv in paid_invoices if inv.get("student_id") is not None})

        students_table = _resolve_students_table()
        student_std_map = {}
        if students_table and student_ids:
            for id_batch in _chunked(student_ids):
                student_rows = supabase.table(students_table).select("id, std").in_("id", id_batch).execute().data or []
                for student in student_rows:
                    student_std_map[str(student.get("id"))] = _normalize_standard(student.get("std"))

        invoice_std_map = {}
        for inv in paid_invoices:
            inv_id = str(inv.get("id")).strip()
            std = student_std_map.get(str(inv.get("student_id")))
            if inv_id and std in sold_by_standard:
                invoice_std_map[inv_id] = std

        if invoice_ids and product_tokens:
            for invoice_batch in _chunked(invoice_ids):
                item_rows = supabase.table("invoice_items").select("invoice_id, item_name, quantity").in_("invoice_id", invoice_batch).execute().data or []
                for item in item_rows:
                    invoice_id = str(item.get("invoice_id")).strip()
                    std = invoice_std_map.get(invoice_id)
                    if std not in sold_by_standard:
                        continue

                    item_token = _normalize_item_token(item.get("item_name"))
                    if item_token not in product_tokens:
                        continue

                    qty = _to_int(item.get("quantity"), 0)
                    if qty > 0:
                        sold_by_standard[std][item_token] += qty

        for standard in range(1, 11):
            std_key = str(standard)
            row = {"standard": std_key}
            total = 0
            for token in product_tokens:
                value = int(sold_by_standard[std_key].get(token, 0))
                row[token] = value
                total += value
            row["total"] = total
            rows_out.append(row)

        return jsonify({"success": True, "columns": product_tokens, "rows": rows_out}), 200
    except Exception as e:
        print(f"Get total sold report error: {str(e)}")
        return jsonify({"success": False, "message": f"Server error: {str(e)}", "columns": [], "rows": []}), 500


@schools_bp.route("/stocks/total-remaining-report", methods=["GET"])
def get_total_remaining_report():
    """Get remaining stock records for XLS export in table format."""
    try:
        school_id = str(request.args.get("school_id", "")).strip()
        if not school_id:
            return jsonify({"success": False, "message": "school_id is required", "rows": []}), 400

        stock_table = _resolve_stock_table()
        if not stock_table:
            return jsonify({"success": True, "rows": []}), 200

        try:
            stock_rows = supabase.table(stock_table).select("*").eq("school_id", school_id).order("standard", desc=False).execute().data or []
        except Exception:
            stock_rows = supabase.table(stock_table).select("*").order("standard", desc=False).execute().data or []

        normalized_rows = []
        for row in stock_rows:
            standard = str(row.get("standard") or "").strip()
            item = str(row.get("item") or "").strip()
            gender = str(row.get("gender") or "").strip()
            stock = _to_int(row.get("stock"), 0)

            if not standard or not item:
                continue

            normalized_rows.append({
                "standard": standard,
                "item": item,
                "gender": gender,
                "stock": stock
            })

        normalized_rows.sort(key=lambda x: (
            int(x["standard"]) if x["standard"].isdigit() else 999,
            x["item"],
            x["gender"]
        ))

        return jsonify({"success": True, "rows": normalized_rows}), 200
    except Exception as e:
        print(f"Get total remaining report error: {str(e)}")
        return jsonify({"success": False, "message": f"Server error: {str(e)}", "rows": []}), 500

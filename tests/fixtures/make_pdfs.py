"""Generates synthetic bank statements for tests (no real data)."""
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
import random
random.seed(7)

ROWS = [
 ("01 Mar 2026","POS PURCHASE SHOPRITE LEKKI 4471",0,18500.00),
 ("02 Mar 2026","NIP TRF FROM ADEOLA JOHNSON SALARY MARCH",450000.00,0),
 ("03 Mar 2026","MTN AIRTIME VTU 08031234567",0,2000.00),
 ("04 Mar 2026","BOLT RIDE LAGOS",0,3200.50),
 ("04 Mar 2026","SMS ALERT CHARGE",0,4.00),
 ("05 Mar 2026","DSTV SUBSCRIPTION COMPACT PLUS",0,10500.00),
 ("07 Mar 2026","ATM WDL / FIRST BANK / VI BRANCH LAGOS NIGERIA REF 0099887766",0,20000.00),
 ("08 Mar 2026","CHICKEN REPUBLIC IKEJA CITY MALL",0,6800.00),
 ("10 Mar 2026","IKEDC PREPAID METER 04112233",0,15000.00),
 ("12 Mar 2026","TOTAL ENERGIES FILLING STATION",0,25000.00),
]
def build(path, rows_per_page):
    c = canvas.Canvas(path, pagesize=A4); W,H = A4
    bal = 500000.00; y = H-60; page=1
    def header():
        nonlocal y
        c.setFont("Helvetica-Bold",14); c.drawString(40,H-40,"Example Bank Plc"); c.setFont("Helvetica",9)
        c.drawString(40,H-54,"Statement Period: 01 Mar 2026 to 31 Mar 2026   Account Number 0123456789")
        y = H-90; c.setFont("Helvetica-Bold",9)
        c.drawString(40,y,"Date"); c.drawString(110,y,"Description"); c.drawRightString(400,y,"Debit"); c.drawRightString(470,y,"Credit"); c.drawRightString(555,y,"Balance")
        y -= 16; c.setFont("Helvetica",9)
    header(); c.drawString(110,y,"Opening Balance"); c.drawRightString(555,y,f"{bal:,.2f}"); y-=14
    n=0
    for d,desc,cr,dr in ROWS:
        if n and n % rows_per_page == 0:
            c.setFont("Helvetica",8); c.drawString(40,30,f"Page {page}"); c.showPage(); page+=1; header()
        bal += cr - dr
        c.drawString(40,y,d)
        if len(desc) > 38:
            c.drawString(110,y,desc[:38])
        else: c.drawString(110,y,desc)
        if dr: c.drawRightString(400,y,f"{dr:,.2f}")
        if cr: c.drawRightString(470,y,f"{cr:,.2f}")
        c.drawRightString(555,y,f"{bal:,.2f}")
        if len(desc) > 38: y-=11; c.drawString(110,y,desc[38:])
        y -= 16; n+=1
    c.drawString(110,y,"Closing Balance"); c.drawRightString(555,y,f"{bal:,.2f}")
    c.setFont("Helvetica",8); c.drawString(40,30,f"Page {page}"); c.save(); return bal

print(build("tests/fixtures/stmt_columns.pdf", 6))

# layout 2: single amount column with CR/DR suffix and running balance, no header words for debit/credit
c = canvas.Canvas("tests/fixtures/stmt_crdr.pdf", pagesize=A4); W,H=A4; y=H-80
c.setFont("Helvetica",9); c.drawString(40,H-40,"Statement Period: 01/03/2026 - 31/03/2026")
c.drawString(40,y,"Brought Forward"); c.drawRightString(555,y,"100,000.00"); y-=16
bal=100000.0
for d,desc,amt,sign in [("01/03/2026","SALARY ACME LTD",300000.0,"CR"),("02/03/2026","SHOPRITE SURULERE",12000.0,"DR"),("09/03/2026","NETFLIX.COM",4500.0,"DR")]:
    bal += amt if sign=="CR" else -amt
    c.drawString(40,y,d); c.drawString(110,y,desc); c.drawRightString(400,y,f"{amt:,.2f} {sign}"); c.drawRightString(555,y,f"{bal:,.2f}"); y-=16
c.drawString(40,y,"Carried Forward"); c.drawRightString(555,y,f"{bal:,.2f}"); c.save(); print(bal)

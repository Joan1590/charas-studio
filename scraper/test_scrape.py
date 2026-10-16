"""Run: make test"""
from scrape_charas import parse_items, split_title

CELL = """<a  href=javascript:poporiginale('layer=1&id=115');>
<img src='viewer.php?base_sizeset=1&row=3&scale=2&img=115' title='Normal Body, by Iron' alt=''></a>
<img src='viewer.php?base_sizeset=1&row=3&scale=2&img=9' title='Tom &amp; Jerry, by me, by You' alt=''>"""

assert split_title("Plain") == ("Plain", "")
assert parse_items(CELL) == [
    {"id": 115, "t": "Normal Body", "a": "Iron"},
    {"id": 9, "t": "Tom & Jerry, by me", "a": "You"},
]
print("ok")

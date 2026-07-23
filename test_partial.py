import urllib.request, json
data = json.dumps({"username":"admin","password":"admin123"}).encode()
req = urllib.request.Request("http://localhost:8000/api/v1/login/", data=data, headers={"Content-Type":"application/json"}, method="POST")
token = json.loads(urllib.request.urlopen(req).read())["access"]

# Check initial
req = urllib.request.Request("http://localhost:8000/api/v1/cases/hybseq/pending_mixes/", headers={"Authorization": f"Bearer {token}"})
mixes = json.loads(urllib.request.urlopen(req).read()).get("mixes",[])
print(f"Before: {len(mixes)} mixes")
for m in mixes: print(f"  {m['mix_name']}")

# Create with only mix1
mid1 = mixes[0]["id"]
data = json.dumps({"mix_ids": [mid1], "chip_number": "T5"}).encode()
req = urllib.request.Request("http://localhost:8000/api/v1/cases/hybseq/", data=data, headers={"Content-Type":"application/json", "Authorization":f"Bearer {token}"}, method="POST")
r = json.loads(urllib.request.urlopen(req).read())
print(f"Created with: {mid1}")

# Check after - should still have mix2
req = urllib.request.Request("http://localhost:8000/api/v1/cases/hybseq/pending_mixes/", headers={"Authorization": f"Bearer {token}"})
mixes2 = json.loads(urllib.request.urlopen(req).read()).get("mixes",[])
print(f"After: {len(mixes2)} mixes {'OK' if len(mixes2)==1 else 'FAIL'}")
for m in mixes2: print(f"  {m['mix_name']}")

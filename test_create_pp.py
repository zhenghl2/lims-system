import urllib.request, json
data = json.dumps({'username':'admin','password':'admin123'}).encode()
req = urllib.request.Request('http://localhost:8000/api/v1/login/', data=data, headers={'Content-Type':'application/json'}, method='POST')
token = json.loads(urllib.request.urlopen(req).read())['access']

# Get pending samples
req2 = urllib.request.Request('http://localhost:8000/api/v1/cases/preprocessing/pending/', headers={'Authorization': f'Bearer {token}'})
p = json.loads(urllib.request.urlopen(req2).read())
entries = p.get('entries',[])
if entries:
    ids = entries[0].get('case_sample_ids',[])
    print(f"Creating batch with {len(ids)} sample IDs")
    req3 = urllib.request.Request('http://localhost:8000/api/v1/cases/preprocessing/', 
        data=json.dumps({'case_sample_ids':ids}).encode(),
        headers={'Authorization': f'Bearer {token}', 'Content-Type':'application/json'}, method='POST')
    resp = json.loads(urllib.request.urlopen(req3).read())
    print(f"Batch created: {resp.get('batch_number')}")
    
    # Check workflow_stage
    req4 = urllib.request.Request('http://localhost:8000/api/v1/cases/dashboard/', headers={'Authorization': f'Bearer {token}'})
    d = json.loads(urllib.request.urlopen(req4).read())
    print(f"Dashboard: pp={d['workflow_stages'].get('pre_processing')}, reg={d['workflow_stages'].get('registered')}")
else:
    print("No pending samples")

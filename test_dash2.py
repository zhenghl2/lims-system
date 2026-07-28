import urllib.request, json
data = json.dumps({'username':'admin','password':'admin123'}).encode()
req = urllib.request.Request('http://localhost:8000/api/v1/login/', data=data, headers={'Content-Type':'application/json'}, method='POST')
token = json.loads(urllib.request.urlopen(req).read())['access']

req = urllib.request.Request('http://localhost:8000/api/v1/cases/dashboard/', headers={'Authorization': f'Bearer {token}'})
d = json.loads(urllib.request.urlopen(req).read())
print("Dashboard:", json.dumps(d['workflow_stages']))

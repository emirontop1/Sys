<!DOCTYPE html>
<html>
<head>
<script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-[#0b1120] text-white">

<div class="flex h-screen">

<aside class="w-72 bg-[#111827] p-5">
    <h1 class="text-3xl font-bold">HubTrack</h1>

    <div class="mt-8 space-y-3">
        <button class="w-full text-left p-3 rounded bg-slate-800">Dashboard</button>
        <button class="w-full text-left p-3 rounded bg-slate-800">Logs</button>
        <button class="w-full text-left p-3 rounded bg-slate-800">Search</button>
    </div>
</aside>

<main class="flex-1 p-8">

<div class="grid grid-cols-4 gap-4">
    <div class="bg-slate-900 rounded-xl p-5">
        <p>Total Executes</p>
        <h2 id="executes" class="text-3xl font-bold">0</h2>
    </div>

    <div class="bg-slate-900 rounded-xl p-5">
        <p>Unique Users</p>
        <h2 id="users" class="text-3xl font-bold">0</h2>
    </div>
</div>

<div class="mt-8">
<input id="search" placeholder="Search username..."
class="w-full bg-slate-900 p-4 rounded-xl">
</div>

<div id="logs" class="mt-8 space-y-3"></div>

</main>
</div>

<script>
async function loadStats(){
    const res=await fetch('/api/track?action=stats')
    const data=await res.json()
    document.getElementById('executes').innerText=data.totalExecutes
    document.getElementById('users').innerText=data.totalUsers
}

async function loadLogs(){
    const res=await fetch('/api/track?action=logs')
    const logs=await res.json()
    const c=document.getElementById('logs')
    c.innerHTML=''

    logs.forEach(log=>{
        c.innerHTML += `
        <div class="bg-slate-900 rounded-xl p-4">
            <div>${log.username}</div>
            <div>${log.executor}</div>
            <div>Execute #${log.executeNumber}</div>
        </div>
        `
    })
}

loadStats()
loadLogs()
</script>

</body>
</html>

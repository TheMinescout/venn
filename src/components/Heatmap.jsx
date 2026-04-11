import React, { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '../supabase';
import ICAL from 'ical.js';
import { 
  Calendar, Users, Lock, Share2, MousePointer2, CheckCircle2, 
  XCircle, ChevronLeft, ChevronRight, LayoutDashboard, Zap, 
  ShieldCheck, RefreshCw, ArrowRight, Settings, CalendarDays,
  Trash2, CheckSquare, FlipHorizontal, ArrowDown, Unlock
} from 'lucide-react';

export default function Heatmap() {
  const [groupId, setGroupId] = useState(window.location.hash.replace('#/', ''));
  const [groupInfo, setGroupInfo] = useState(null);
  const [newTitle, setNewTitle] = useState("");
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState("");
  const [granularity, setGranularity] = useState(60);
  const [weekOffset, setWeekOffset] = useState(0);

  const [userName, setUserName] = useState(localStorage.getItem('venn_name') || '');
  const [password, setPassword] = useState(localStorage.getItem('venn_pw') || '');
  const [isAuthorized, setIsAuthorized] = useState(true);
  const [isLockedBySomeone, setIsLockedBySomeone] = useState(false);
  const [allData, setAllData] = useState([]);
  
  // Drag State
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState(null);
  const [dragEnd, setDragEnd] = useState(null);
  const [dragAction, setDragAction] = useState(null); // 'add' or 'remove'
  
  const [hoveredBlock, setHoveredBlock] = useState(null);
  const [calUrl, setCalUrl] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [ignoreAllDay, setIgnoreAllDay] = useState(true); 
  const [showSecurityMenu, setShowSecurityMenu] = useState(false);

  // --- REFS FOR LANDING PAGE ---
  const createRef = useRef(null);
  const featuresRef = useRef(null);
  const scrollTo = (ref) => ref.current?.scrollIntoView({ behavior: 'smooth' });

  // --- ROUTING ---
  useEffect(() => {
    const handleHash = () => setGroupId(window.location.hash.replace('#/', ''));
    window.addEventListener('hashchange', handleHash);
    if (groupId) fetchGroupInfo();
    return () => window.removeEventListener('hashchange', handleHash);
  }, [groupId]);

  const fetchGroupInfo = async () => {
    if (!groupId) return;
    const { data } = await supabase.from('groups').select('*').eq('id', groupId).single();
    if (data) setGroupInfo(data);
  };

  const createGroup = async () => {
    if (!newTitle || !startDate || !endDate) return alert("Fill in all fields!");
    const id = Math.random().toString(36).substring(2, 9);
    const { error } = await supabase.from('groups').insert({ id, title: newTitle, start_date: startDate, end_date: endDate, granularity });
    if (!error) {
      window.location.hash = `/${id}`;
    } else alert(error.message);
  };

  // --- DATA SYNC ---
  const fetchData = async () => {
    if (!groupId) return;
    const { data } = await supabase.from('squad_blocks').select('*').eq('group_id', groupId);
    setAllData(data || []);
  };

  useEffect(() => {
    if (!groupId) return;
    fetchData();
    const sub = supabase.channel(`g-${groupId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'squad_blocks', filter: `group_id=eq.${groupId}` }, fetchData).subscribe();
    return () => supabase.removeChannel(sub);
  }, [groupId]);

  useEffect(() => {
    if (!userName) return;
    const check = async () => {
      const { data } = await supabase.from('user_settings').select('password, ignore_all_day').eq('user_name', userName).single();
      // Added a check for empty string since we are using that instead of NULL now
      if (data && data.password && data.password.trim() !== "") { 
        setIsLockedBySomeone(true); 
        setIsAuthorized(data.password === password); 
        setIgnoreAllDay(data.ignore_all_day);
      } else { 
        setIsLockedBySomeone(false); 
        setIsAuthorized(true); 
        if (data) setIgnoreAllDay(data.ignore_all_day);
      }
    };
    check();
  }, [userName, password]);

  // --- PASSWORD MANAGEMENT ---
  const handleSetPassword = async () => {
    if (!password) return alert("Please enter a password in the top bar first.");
    const { error } = await supabase.from('user_settings').upsert({ user_name: userName, password: password, ignore_all_day: ignoreAllDay });
    if (!error) {
        setIsLockedBySomeone(true);
        alert("Password protection enabled!");
    } else alert(error.message);
  };

  const handleRemovePassword = async () => {
    if (window.confirm("Are you sure you want to remove password protection for this name?")) {
        // Changed from null to empty string "" to avoid NOT NULL constraint errors
        const { error } = await supabase.from('user_settings').update({ password: "" }).eq('user_name', userName);
        if (!error) {
            setIsLockedBySomeone(false);
            setPassword('');
            localStorage.removeItem('venn_pw');
            alert("Password removed!");
        } else alert(error.message);
    }
  };

  // --- CALCS & MEMOIZATION (Performance Fixes) ---
  const DATES = useMemo(() => {
    if (!groupInfo) return [];
    const start = new Date(groupInfo.start_date);
    const end = new Date(groupInfo.end_date);
    const arr = [];
    for (let dt = new Date(start); dt <= end; dt.setDate(dt.getDate() + 1)) arr.push(new Date(dt).toISOString().split('T')[0]);
    return arr;
  }, [groupInfo]);

  const SLOTS = useMemo(() => {
    const steps = groupInfo?.granularity || 60;
    const slots = [];
    for (let h = 8; h < 22; h++) {
      for (let m = 0; m < 60; m += steps) slots.push(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`);
    }
    return slots;
  }, [groupInfo]);

  const currentWeekDates = useMemo(() => {
    return DATES.slice(weekOffset * 7, (weekOffset * 7) + 7);
  }, [DATES, weekOffset]);

  // O(1) lookup for your personal blocks
  const myBlocksSet = useMemo(() => {
    return new Set((allData || []).filter(d => d.user_name === userName).map(d => d.block_id));
  }, [allData, userName]);

  // Pre-calculate heatmap intensities
  const heatmapStats = useMemo(() => {
    const counts = {};
    const users = new Set();
    (allData || []).forEach(d => {
      counts[d.block_id] = (counts[d.block_id] || 0) + 1;
      users.add(d.user_name);
    });
    return { counts, total: Math.max(users.size, 1) };
  }, [allData]);

  // --- TOOLS ---
  const handleSelectAll = async () => {
    if (!userName) return alert("Enter name!");
    const inserts = [];
    DATES.forEach(d => SLOTS.forEach(s => inserts.push({ group_id: groupId, block_id: `${d}-${s}`, user_name: userName })));
    await supabase.from('squad_blocks').upsert(inserts);
    fetchData();
  };

  const handleClearAll = async () => {
    if (!userName) return alert("Enter name!");
    if (window.confirm("Clear your schedule?")) {
      await supabase.from('squad_blocks').delete().match({ group_id: groupId, user_name: userName });
      fetchData();
    }
  };

  const handleInvert = async () => {
    if (!userName) return;
    const inverted = [];
    DATES.forEach(d => SLOTS.forEach(s => {
        const bid = `${d}-${s}`;
        if (!myBlocksSet.has(bid)) inverted.push({ group_id: groupId, block_id: bid, user_name: userName });
    }));
    await supabase.from('squad_blocks').delete().match({ group_id: groupId, user_name: userName });
    await supabase.from('squad_blocks').upsert(inverted);
    fetchData();
  };

  const handleCalendarSync = async () => {
    setIsSyncing(true);
    try {
      let calId = calUrl;
      if (calUrl.includes("cid=")) calId = atob(calUrl.split('cid=')[1].split('&')[0]);
      else if (calUrl.includes("src=")) calId = decodeURIComponent(calUrl.split('src=')[1].split('&')[0]);
      const scriptUrl = "https://script.google.com/macros/s/AKfycbyzwwbQhCzjXUO9Bo_TE3ekaFg7--Y61njos8QW2Kj9UsFFLd4LyoUTDWLMb2dwY94k/exec";
      const res = await fetch(`${scriptUrl}?calId=${encodeURIComponent(calId)}`);
      const ics = await res.text();
      const jcal = ICAL.parse(ics);
      const events = new ICAL.Component(jcal).getAllSubcomponents('vevent');
      const busy = [];
      events.forEach(ev => {
        const item = new ICAL.Event(ev);
        const start = item.startDate.toJSDate();
        const end = item.endDate.toJSDate();
        if ((item.startDate.isDate || (end-start)/3600000 >= 23) && ignoreAllDay) return;
        DATES.forEach(d => SLOTS.forEach(s => {
          const sT = new Date(d + 'T' + s + ':00');
          const eT = new Date(sT.getTime() + (groupInfo?.granularity || 60) * 60000);
          if (start < eT && end > sT) busy.push(`${d}-${s}`);
        }));
      });
      if (busy.length) await supabase.from('squad_blocks').delete().match({ group_id: groupId, user_name: userName }).in('block_id', busy);
      fetchData();
      alert("Sync Complete!");
    } catch (e) { alert("Sync failed."); }
    setIsSyncing(false);
  };

  // --- INTERACTION ---
  const handleMouseDown = (d, s) => { 
    if (!isAuthorized || !userName) return; 
    setIsDragging(true); 
    
    // Determine if we are painting 'on' or 'off' based on the first cell
    const bid = `${currentWeekDates[d]}-${SLOTS[s]}`;
    setDragAction(myBlocksSet.has(bid) ? 'remove' : 'add');
    
    setDragStart({ dateIdx: d, slotIdx: s }); 
    setDragEnd({ dateIdx: d, slotIdx: s }); 
  };
  
  const handleMouseEnter = (d, s) => { 
    if (isDragging) setDragEnd({ dateIdx: d, slotIdx: s }); 
  };
  
  const commitDrag = async () => {
    if (!dragStart || !dragEnd || !userName) { setIsDragging(false); return; }
    
    const minD = Math.min(dragStart.dateIdx, dragEnd.dateIdx); const maxD = Math.max(dragStart.dateIdx, dragEnd.dateIdx);
    const minS = Math.min(dragStart.slotIdx, dragEnd.slotIdx); const maxS = Math.max(dragStart.slotIdx, dragEnd.slotIdx);
    
    const blocksToProcess = [];
    for (let d = minD; d <= maxD; d++) {
        for (let s = minS; s <= maxS; s++) {
            blocksToProcess.push(`${currentWeekDates[d]}-${SLOTS[s]}`);
        }
    }

    if (dragAction === 'remove') {
      await supabase.from('squad_blocks').delete().match({ group_id: groupId, user_name: userName }).in('block_id', blocksToProcess);
    } else {
      // Only upsert blocks that aren't already there to save network request size
      const newBlocks = blocksToProcess.filter(b => !myBlocksSet.has(b));
      if (newBlocks.length > 0) {
        await supabase.from('squad_blocks').upsert(newBlocks.map(bid => ({ group_id: groupId, block_id: bid, user_name: userName })));
      }
    }
    
    setIsDragging(false); setDragStart(null); setDragEnd(null); setDragAction(null);
    fetchData();
  };

  const isBlockSelected = (dIdx, sIdx) => {
    if (!isDragging || !dragStart || !dragEnd) return false;
    const minD = Math.min(dragStart.dateIdx, dragEnd.dateIdx); const maxD = Math.max(dragStart.dateIdx, dragEnd.dateIdx);
    const minS = Math.min(dragStart.slotIdx, dragEnd.slotIdx); const maxS = Math.max(dragStart.slotIdx, dragEnd.slotIdx);
    return dIdx >= minD && dIdx <= maxD && sIdx >= minS && sIdx <= maxS;
  };

  const getHeatmapColor = (bid) => {
    const count = heatmapStats.counts[bid] || 0;
    if (count === 0) return 'bg-slate-50 border-slate-100';
    const intensity = count / heatmapStats.total;
    return intensity === 1 ? 'bg-emerald-500 border-emerald-600' : intensity > 0.5 ? 'bg-emerald-300 border-emerald-400' : 'bg-emerald-100 border-emerald-200';
  };

  // --- VIEWS ---
  if (!groupId) {
    return (
      <div className="min-h-screen bg-white text-slate-900 font-sans select-none scroll-smooth">
        <nav className="fixed top-0 left-0 right-0 bg-white/80 backdrop-blur-md z-50 border-b border-slate-100">
          <div className="max-w-7xl mx-auto px-8 py-6 flex justify-between items-center">
            <div className="text-3xl font-black italic tracking-tighter text-emerald-500">VENN.</div>
            <div className="flex gap-8 text-[10px] font-black uppercase tracking-widest text-slate-400">
               <button onClick={() => scrollTo(featuresRef)} className="hover:text-emerald-500">Features</button>
               <button onClick={() => scrollTo(createRef)} className="bg-emerald-500 text-white px-6 py-2 rounded-xl">Create Event</button>
            </div>
          </div>
        </nav>

        <section className="pt-48 pb-32 px-8 max-w-7xl mx-auto grid lg:grid-cols-2 gap-16 items-center">
          <div>
            <h1 className="text-8xl font-black tracking-tighter leading-[0.85] mb-8 italic">The <span className="text-emerald-500">Perfect</span> <br/>Overlap.</h1>
            <p className="text-xl text-slate-400 font-medium max-w-md italic mb-12">No accounts. No emails. Coordinate squads of 2 or 2,000 in seconds.</p>
            <button onClick={() => scrollTo(createRef)} className="bg-slate-900 text-white px-10 py-5 rounded-[2rem] font-black text-xs uppercase tracking-widest">Get Started <ArrowDown className="inline ml-2" size={16}/></button>
          </div>
          <div className="hidden lg:block bg-slate-50 border p-12 rounded-[4rem] rotate-2 shadow-2xl">
             <div className="grid grid-cols-4 gap-4 opacity-20">
                {Array.from({length: 12}).map((_, i) => <div key={i} className="h-12 bg-emerald-500 rounded-2xl"></div>)}
             </div>
          </div>
        </section>

        <section ref={featuresRef} className="py-32 bg-slate-50 border-y">
           <div className="max-w-7xl mx-auto px-8 grid md:grid-cols-3 gap-16 text-center">
              <div><Users className="mx-auto text-emerald-500 mb-6" size={40}/><h3 className="text-xl font-black uppercase italic mb-4">Any Group Size</h3><p className="text-sm text-slate-500 leading-relaxed font-medium">From intimate dinners to massive conferences. Venn handles any number of participants live.</p></div>
              <div><MousePointer2 className="mx-auto text-emerald-500 mb-6" size={40}/><h3 className="text-xl font-black uppercase italic mb-4">Box Selection</h3><p className="text-sm text-slate-500 leading-relaxed font-medium">Stop clicking. Drag a rectangle to fill days of availability instantly.</p></div>
              <div><Zap className="mx-auto text-emerald-500 mb-6" size={40}/><h3 className="text-xl font-black uppercase italic mb-4">Auto-Sync</h3><p className="text-sm text-slate-500 leading-relaxed font-medium">Paste your calendar link once. We scan your busy slots and keep your Venn schedule accurate.</p></div>
           </div>
        </section>

        <section ref={createRef} className="py-32 px-8 text-center max-w-7xl mx-auto">
           <div className="max-w-xl mx-auto bg-white p-12 rounded-[4rem] shadow-2xl border">
              <h2 className="text-3xl font-black mb-8 italic uppercase tracking-tighter">Plan your Event</h2>
              <div className="space-y-6 text-left">
                 <input type="text" placeholder="Event Name..." className="w-full border-2 p-6 rounded-3xl font-bold outline-none focus:border-emerald-500 text-lg" value={newTitle} onChange={e => setNewTitle(e.target.value)} />
                 <div className="grid grid-cols-2 gap-4">
                    <input type="date" className="w-full border-2 p-5 rounded-3xl font-bold" value={startDate} onChange={e => setStartDate(e.target.value)} />
                    <input type="date" className="w-full border-2 p-5 rounded-3xl font-bold" value={endDate} onChange={e => setEndDate(e.target.value)} />
                 </div>
                 <div className="bg-slate-50 p-5 rounded-3xl flex justify-between items-center">
                    <span className="text-[10px] font-black uppercase text-slate-400">Precision:</span>
                    <select className="bg-transparent font-black text-emerald-600 outline-none" value={granularity} onChange={e => setGranularity(parseInt(e.target.value))}>
                       <option value={60}>60 Min</option><option value={30}>30 Min</option><option value={15}>15 Min</option>
                    </select>
                 </div>
                 <button onClick={createGroup} className="w-full bg-emerald-500 text-white font-black py-7 rounded-[2.5rem] text-xl shadow-xl shadow-emerald-200 hover:scale-[1.02] transition-all">Generate Link 🚀</button>
              </div>
           </div>
        </section>
      </div>
    );
  }

  // --- DASHBOARD ---
  const availNow = hoveredBlock ? (allData || []).filter(d => d.block_id === hoveredBlock).map(d => d.user_name) : [];
  const uniqueList = [...new Set((allData || []).map(d => d.user_name))];
  const unavailNow = uniqueList.filter(u => !availNow.includes(u));

  return (
    <div className="min-h-screen bg-slate-50 p-4 lg:p-10 select-none font-sans overflow-x-hidden">
      <div className="max-w-[1700px] mx-auto space-y-6">
        
        <header className="bg-white p-8 rounded-[3.5rem] shadow-xl border flex flex-col xl:flex-row justify-between items-center gap-8">
           <div className="text-center xl:text-left">
              <h1 className="text-5xl font-black tracking-tighter italic text-slate-800 uppercase leading-none">{groupInfo?.title || 'Loading...'}</h1>
              <button onClick={() => {navigator.clipboard.writeText(window.location.href); alert("Link copied!")}} className="mt-6 flex items-center gap-2 bg-emerald-500 text-white px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-lg hover:bg-emerald-600 transition-colors">
                 <Share2 size={14}/> Invite Friends
              </button>
           </div>
           
           <div className="flex flex-wrap justify-center gap-4 bg-slate-50 p-5 rounded-[3rem] border border-slate-100 relative shadow-inner">
              <div className="flex flex-col">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Your Name</span>
                <input type="text" className="border-2 p-3 rounded-2xl font-bold w-44 outline-none focus:border-emerald-500 bg-white shadow-sm" value={userName} onChange={e => {setUserName(e.target.value); localStorage.setItem('venn_name', e.target.value);}} />
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1 flex items-center gap-1">
                  Password {isLockedBySomeone && <Lock size={10} className="text-emerald-500"/>}
                </span>
                <input type="password" className={`border-2 p-3 rounded-2xl font-bold w-44 outline-none focus:border-emerald-500 bg-white shadow-sm ${isLockedBySomeone && !isAuthorized ? 'border-rose-400 text-rose-500' : ''}`} value={password} onChange={e => {setPassword(e.target.value); localStorage.setItem('venn_pw', e.target.value);}} />
              </div>
              {isAuthorized && userName && (
                <div className="flex items-end pb-1 relative">
                  <button onClick={() => setShowSecurityMenu(!showSecurityMenu)} className="bg-white border-2 shadow-sm p-4 rounded-2xl hover:bg-slate-50 transition-all text-emerald-500"><Settings size={20}/></button>
                  {showSecurityMenu && (
                    <div className="absolute top-20 right-0 bg-white shadow-2xl rounded-[3rem] border p-8 z-50 w-80 space-y-6 animate-in zoom-in-95 fade-in duration-300 text-center mt-2">
                        
                        <div className="flex items-center justify-center gap-3"><RefreshCw size={18} className="text-emerald-500"/><h4 className="font-black text-xs uppercase tracking-widest text-slate-800 italic text-center">Auto-Sync</h4></div>
                        <input type="text" placeholder="Paste Link / CID..." className="w-full border-2 p-4 rounded-2xl text-[10px] font-bold bg-slate-50 outline-none" value={calUrl} onChange={e => setCalUrl(e.target.value)} />
                        <div className="flex items-center gap-3 px-1 text-left">
                            <input type="checkbox" id="ign" checked={ignoreAllDay} onChange={e => setIgnoreAllDay(e.target.checked)} className="w-4 h-4 accent-emerald-500" />
                            <label htmlFor="ign" className="text-[10px] font-bold text-slate-500 uppercase tracking-tight italic cursor-pointer">Ignore All-Day Events</label>
                        </div>
                        <button onClick={handleCalendarSync} disabled={isSyncing} className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-black p-5 rounded-2xl text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 transition-colors">
                            {isSyncing ? "..." : <Zap size={16}/>} Sync Schedule
                        </button>

                        <div className="pt-6 border-t border-slate-100">
                           <div className="flex items-center justify-center gap-3 mb-4"><ShieldCheck size={18} className="text-emerald-500"/><h4 className="font-black text-xs uppercase tracking-widest text-slate-800 italic text-center">Security</h4></div>
                           {isLockedBySomeone ? (
                               <button onClick={handleRemovePassword} className="w-full bg-rose-50 text-rose-500 hover:bg-rose-100 font-black p-4 rounded-2xl text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 transition-all">
                                   <XCircle size={16}/> Remove Password
                               </button>
                           ) : (
                               <>
                                 <button onClick={handleSetPassword} className="w-full bg-slate-900 text-white hover:bg-slate-800 font-black p-4 rounded-2xl text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 transition-all">
                                     <Lock size={16}/> Protect Name
                                 </button>
                                 <p className="text-[9px] text-slate-400 mt-3 font-medium">Enter a password in the top bar, then click here to lock your name.</p>
                               </>
                           )}
                        </div>

                    </div>
                  )}
                </div>
              )}
           </div>
        </header>

        <div className="flex justify-between items-center bg-white p-6 rounded-[3rem] shadow-sm border">
           <button disabled={weekOffset === 0} onClick={() => setWeekOffset(v => v-1)} className="font-black text-[10px] uppercase tracking-widest disabled:opacity-10 px-6 py-3 border rounded-2xl hover:bg-slate-50 transition-colors">Back</button>
           <div className="text-[11px] font-black text-emerald-500 uppercase tracking-[0.5em] italic underline underline-offset-8">Week {weekOffset + 1}</div>
           <button disabled={(weekOffset+1)*7 >= DATES.length} onClick={() => setWeekOffset(v => v+1)} className="font-black text-[10px] uppercase tracking-widest disabled:opacity-10 px-6 py-3 border rounded-2xl hover:bg-slate-50 transition-colors">Next</button>
        </div>

        <div className="grid xl:grid-cols-[1fr_1fr_340px] gap-8">
          <div className={`bg-white p-8 rounded-[4rem] shadow-2xl border transition-all ${!isAuthorized ? 'opacity-20 pointer-events-none' : ''}`}>
             <div className="flex justify-between items-center mb-10">
                <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] italic">1. My Availability</h3>
                <div className="flex gap-2">
                   <button onClick={handleSelectAll} className="p-2 text-emerald-500 border rounded-lg hover:bg-emerald-50 transition-all" title="Select All"><CheckSquare size={14}/></button>
                   <button onClick={handleInvert} className="p-2 text-blue-500 border rounded-lg hover:bg-blue-50 transition-all" title="Invert Selection"><FlipHorizontal size={14}/></button>
                   <button onClick={handleClearAll} className="p-2 text-rose-500 border rounded-lg hover:bg-rose-50 transition-all" title="Clear All"><Trash2 size={14}/></button>
                </div>
             </div>
             <div className="overflow-x-auto pb-6">
                <div className="grid gap-1.5 touch-none" style={{ gridTemplateColumns: `70px repeat(${currentWeekDates.length}, 1fr)` }} onMouseUp={commitDrag} onMouseLeave={() => {if(isDragging) commitDrag()}}>
                   <div />
                   {currentWeekDates.map(d => (
                    <div key={d} className="text-center pb-4 italic">
                      <p className="text-[10px] font-black text-slate-300 uppercase tracking-tighter">{new Date(d).toLocaleDateString('en-US', {weekday: 'short'})}</p>
                      <p className="text-xs font-black text-slate-700">{new Date(d).toLocaleDateString('en-US', {month: 'short', day: 'numeric'})}</p>
                    </div>
                   ))}
                   {SLOTS.map((slot, sIdx) => (
                      <React.Fragment key={slot}>
                         <div className="text-[9px] font-black text-slate-300 self-center text-right pr-6 uppercase">{slot}</div>
                         {currentWeekDates.map((date, dIdx) => {
                            const bid = `${date}-${slot}`;
                            const active = myBlocksSet.has(bid);
                            const isSelected = isBlockSelected(dIdx, sIdx);
                            
                            // Visual feedback logic
                            let cellBg = active ? 'bg-emerald-500 border-emerald-600' : 'bg-slate-100 border-white';
                            if (isSelected) {
                                cellBg = dragAction === 'add' ? 'bg-emerald-400 border-emerald-500 z-10 scale-95 opacity-80' : 'bg-rose-400 border-rose-500 z-10 scale-95 opacity-80';
                            }
                            
                            return (
                                <div 
                                    key={bid} 
                                    onMouseDown={() => handleMouseDown(dIdx, sIdx)} 
                                    onMouseEnter={() => handleMouseEnter(dIdx, sIdx)} 
                                    className={`h-8 border rounded-[4px] cursor-crosshair transition-all shadow-sm ${cellBg}`} 
                                />
                            )
                         })}
                      </React.Fragment>
                   ))}
                </div>
             </div>
          </div>

          <div className="bg-white p-8 rounded-[4rem] shadow-2xl border-t-8 border-t-emerald-500 border">
             <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-10 italic">2. Group Heatmap</h3>
             <div className="overflow-x-auto pb-6">
                <div className="grid gap-1.5" style={{ gridTemplateColumns: `70px repeat(${currentWeekDates.length}, 1fr)` }}>
                   <div />
                   {currentWeekDates.map(d => <div key={d} className="text-center pb-4 text-[10px] font-black text-slate-400 uppercase italic tracking-tighter">{new Date(d).toLocaleDateString('en-US', {day: 'numeric'})}</div>)}
                   {SLOTS.map((slot, sIdx) => (
                      <React.Fragment key={slot}>
                         <div className="text-[9px] font-black text-slate-300 self-center text-right pr-6 uppercase">{slot}</div>
                         {currentWeekDates.map(date => {
                            const bid = `${date}-${slot}`;
                            return <div key={bid} onMouseEnter={() => setHoveredBlock(bid)} onMouseLeave={() => setHoveredBlock(null)} className={`h-8 border border-white rounded-[4px] transition-all ${getHeatmapColor(bid)} hover:scale-150 z-0 hover:z-20 shadow-sm`} />
                         })}
                      </React.Fragment>
                   ))}
                </div>
             </div>
          </div>

          <aside className="space-y-8 text-center sticky top-10">
             <div className="bg-white p-10 rounded-[3.5rem] shadow-2xl border h-fit">
                <h3 className="text-xs font-black uppercase mb-10 italic underline underline-offset-8 text-slate-800">Status</h3>
                {hoveredBlock ? (
                   <div className="space-y-8 animate-in fade-in zoom-in-95 duration-200">
                      <div className="bg-slate-50 p-6 rounded-[2.5rem] border shadow-inner">
                         <p className="text-[10px] font-black text-slate-300 uppercase mb-2">Selected Time</p>
                         <p className="font-black text-slate-800 text-2xl italic tracking-tighter">
                            {hoveredBlock.split('-')[3]} {/* Fixed time extraction index */}
                            <span className="text-slate-300 font-normal px-1">on</span> 
                            {new Date(hoveredBlock.split('-').slice(0,3).join('-')).toLocaleDateString('en-US', {month: 'short', day: 'numeric'})}
                         </p>
                      </div>
                      <div className="text-left">
                         <p className="text-[10px] font-black text-emerald-600 uppercase mb-4 px-2 italic underline">Available ({availNow.length})</p>
                         <div className="space-y-3">
                            {availNow.map(u => <div key={u} className="flex items-center gap-4 bg-emerald-50 p-4 rounded-[1.5rem] border border-emerald-100 text-sm font-black text-slate-700 shadow-sm"><div className="w-8 h-8 rounded-xl bg-emerald-500 flex items-center justify-center text-xs text-white uppercase italic">{u[0]}</div> {u}</div>)}
                         </div>
                      </div>
                      <div className="pt-10 border-t text-left">
                         <p className="text-[10px] font-black text-slate-300 uppercase mb-4 italic">Unavailable ({unavailNow.length})</p>
                         <div className="flex flex-wrap gap-2">{unavailNow.map(u => <span key={u} className="text-[10px] font-black text-slate-400 bg-slate-50 px-4 py-2 rounded-full border italic">❌ {u}</span>)}</div>
                      </div>
                   </div>
                ) : <div className="py-24 text-center opacity-30 italic font-black uppercase text-xs tracking-widest">Hover Heatmap</div>}
             </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
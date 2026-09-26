import React, { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '../supabase';
import ICAL from 'ical.js';
import {
  Users, Lock, Share2, MousePointer2, CheckCircle2,
  XCircle, ChevronLeft, ChevronRight, Zap, ShieldCheck,
  RefreshCw, Settings, Trash2, CheckSquare, FlipHorizontal, ArrowDown
} from 'lucide-react';

const AVATAR_COLORS = ['#0d9488', '#0891b2', '#7c3aed', '#db2777', '#ea580c', '#65a30d', '#2563eb'];
const avatarColor = (name) =>
  AVATAR_COLORS[[...(name || 'x')].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length];

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
    const handleHash = () => {
      const currentHash = window.location.hash;
      setGroupId(currentHash.replace('#/', ''));

      // Tell the parent window (if it exists) to update its URL
      if (window.parent !== window) {
        window.parent.postMessage({ type: 'HASH_UPDATE', hash: currentHash }, '*');
      }
    };

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
        const { error } = await supabase.from('user_settings').update({ password: "" }).eq('user_name', userName);
        if (!error) {
            setIsLockedBySomeone(false);
            setPassword('');
            localStorage.removeItem('venn_pw');
            alert("Password removed!");
        } else alert(error.message);
    }
  };

  // --- CALCS & MEMOIZATION ---
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

  // --- VISUAL HELPERS (presentation only) ---
  const todayISO = new Date().toISOString().split('T')[0];
  const weekLabel = useMemo(() => {
    if (!currentWeekDates.length) return '';
    const first = new Date(currentWeekDates[0]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const last = new Date(currentWeekDates[currentWeekDates.length - 1]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${first} – ${last}`;
  }, [currentWeekDates]);

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

  // Smooth emerald ramp: 0 -> white, count == everyone -> full emerald
  const getHeatStyle = (bid) => {
    const count = heatmapStats.counts[bid] || 0;
    if (!count) return {};
    const opacity = Math.min(1, 0.16 + 0.84 * (count / heatmapStats.total));
    return { backgroundColor: `rgba(5, 150, 105, ${opacity.toFixed(3)})` };
  };

  const inputBase = "w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-800 shadow-sm placeholder:text-slate-400 placeholder:font-normal focus:border-emerald-600 focus:outline-none transition-colors";

  // --- VIEWS ---
  if (!groupId) {
    return (
      <div className="min-h-screen bg-paper font-sans text-ink select-none scroll-smooth">
        <nav className="fixed inset-x-0 top-0 z-40 border-b border-slate-200/70 bg-paper/85 backdrop-blur-md">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <div className="flex items-center gap-2.5">
              <span className="flex -space-x-2">
                <span className="block h-4 w-4 rounded-full bg-emerald-400/80 mix-blend-multiply"></span>
                <span className="block h-4 w-4 rounded-full bg-sky-400/70 mix-blend-multiply"></span>
              </span>
              <span className="font-display text-xl font-bold tracking-tight">Venn</span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => scrollTo(featuresRef)} className="rounded-full px-4 py-2 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-200/60 hover:text-slate-800">How it works</button>
              <button onClick={() => scrollTo(createRef)} className="rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700">Create an event</button>
            </div>
          </div>
        </nav>

        <section className="mx-auto grid max-w-6xl items-center gap-16 px-6 pb-24 pt-40 lg:grid-cols-2 lg:pt-48">
          <div>
            <h1 className="font-display text-5xl font-bold leading-[1.02] tracking-tight sm:text-6xl lg:text-7xl">
              Find the time that works for everyone.
            </h1>
            <p className="mt-6 max-w-md text-lg leading-relaxed text-slate-500">
              Share a link, everyone paints in the hours they're free, and the heatmap
              shows exactly where you overlap. No accounts, no emails.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-4">
              <button onClick={() => scrollTo(createRef)} className="group inline-flex items-center gap-2 rounded-2xl bg-ink px-7 py-4 text-sm font-semibold text-white shadow-lg shadow-slate-900/10 transition-all hover:-translate-y-0.5 hover:shadow-xl">
                Create an event
                <ArrowDown size={16} className="transition-transform group-hover:translate-y-0.5" />
              </button>
              <button onClick={() => scrollTo(featuresRef)} className="rounded-2xl px-6 py-4 text-sm font-semibold text-slate-500 transition-colors hover:bg-slate-200/60 hover:text-slate-800">
                See how it works
              </button>
            </div>
          </div>

          {/* The overlap — the brand, drawn */}
          <div className="relative mx-auto hidden aspect-square w-full max-w-md lg:block">
            <div className="anim-slide-left absolute left-[4%] top-[12%] h-64 w-64 rounded-full bg-emerald-300/70 mix-blend-multiply sm:h-72 sm:w-72" />
            <div className="anim-slide-right absolute right-[4%] top-[12%] h-64 w-64 rounded-full bg-sky-300/70 mix-blend-multiply sm:h-72 sm:w-72" />
            <span className="absolute left-[8%] top-[6%] rounded-full border border-emerald-600/20 bg-white/90 px-3 py-1.5 text-xs font-semibold text-emerald-700 shadow-sm">Maya's week</span>
            <span className="absolute right-[8%] top-[6%] rounded-full border border-sky-600/20 bg-white/90 px-3 py-1.5 text-xs font-semibold text-sky-700 shadow-sm">Jon's week</span>
            <span className="anim-pop absolute left-1/2 top-[38%] -translate-x-1/2 rounded-full bg-white px-4 py-2 text-sm font-bold text-teal-700 shadow-lg ring-1 ring-teal-600/10" style={{ animationDelay: '0.7s' }}>
              Sat · 2–4 pm
            </span>
            <div className="anim-rise absolute inset-x-[12%] bottom-[4%] rounded-2xl border border-slate-200 bg-white p-5 shadow-xl" style={{ animationDelay: '0.9s' }}>
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-500">Group heatmap</p>
                <span className="flex items-center gap-1 text-[11px] font-medium text-slate-400">
                  {[12, 36, 60, 84].map(o => <span key={o} className="h-3 w-3 rounded-sm" style={{ backgroundColor: `rgba(5,150,105,${o / 100})` }} />)}
                  <span className="ml-1">everyone</span>
                </span>
              </div>
              <div className="mt-3 grid grid-cols-9 gap-1.5">
                {Array.from({ length: 27 }).map((_, i) => {
                  const seed = (i * 41) % 7;
                  const opacity = [0.08, 0.16, 0.3, 0.55, 0.85, 1, 0.16][seed];
                  return <span key={i} className="h-4 rounded-sm" style={{ backgroundColor: seed === 0 && i % 3 !== 0 ? 'transparent' : `rgba(5,150,105,${opacity})` }} />;
                })}
              </div>
            </div>
          </div>
        </section>

        <section ref={featuresRef} className="border-y border-slate-200/70 bg-white">
          <div className="mx-auto grid max-w-6xl gap-10 px-6 py-20 text-left sm:grid-cols-3 sm:gap-8">
            <div className="rounded-3xl border border-slate-200/80 bg-paper p-8">
              <MousePointer2 className="mb-5 text-emerald-600" size={26} strokeWidth={1.8} />
              <h3 className="font-display text-lg font-bold tracking-tight">Paint your availability</h3>
              <p className="mt-2.5 text-sm leading-relaxed text-slate-500">Drag across the grid to mark hours in seconds — no tapping one box at a time.</p>
            </div>
            <div className="rounded-3xl border border-slate-200/80 bg-paper p-8">
              <Zap className="mb-5 text-emerald-600" size={26} strokeWidth={1.8} />
              <h3 className="font-display text-lg font-bold tracking-tight">Sync your calendar</h3>
              <p className="mt-2.5 text-sm leading-relaxed text-slate-500">Paste a Google Calendar link once and your busy hours stay filled in for you.</p>
            </div>
            <div className="rounded-3xl border border-slate-200/80 bg-paper p-8">
              <Users className="mb-5 text-emerald-600" size={26} strokeWidth={1.8} />
              <h3 className="font-display text-lg font-bold tracking-tight">See the overlap</h3>
              <p className="mt-2.5 text-sm leading-relaxed text-slate-500">Everyone's free hours blend into one live heatmap. The darkest green is your window.</p>
            </div>
          </div>
        </section>

        <section ref={createRef} className="mx-auto max-w-6xl px-6 py-24">
          <div className="mx-auto max-w-lg">
            <h2 className="font-display text-3xl font-bold tracking-tight">Plan your event</h2>
            <p className="mt-2 text-sm text-slate-500">Set the window, share the link — that's the whole setup.</p>
            <div className="mt-8 space-y-5 rounded-3xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-900/5">
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-slate-700" htmlFor="ev-name">Event name</label>
                <input id="ev-name" type="text" placeholder="Saturday climbing trip…" className={inputBase} value={newTitle} onChange={e => setNewTitle(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-slate-700" htmlFor="ev-start">First day</label>
                  <input id="ev-start" type="date" className={inputBase} value={startDate} onChange={e => setStartDate(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-slate-700" htmlFor="ev-end">Last day</label>
                  <input id="ev-end" type="date" className={inputBase} value={endDate} onChange={e => setEndDate(e.target.value)} />
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-slate-700" htmlFor="ev-gran">Time precision</label>
                <select id="ev-gran" className={inputBase} value={granularity} onChange={e => setGranularity(parseInt(e.target.value))}>
                  <option value={60}>Every 60 minutes</option>
                  <option value={30}>Every 30 minutes</option>
                  <option value={15}>Every 15 minutes</option>
                </select>
              </div>
              <button onClick={createGroup} className="w-full rounded-2xl bg-emerald-600 py-4 text-sm font-semibold text-white shadow-lg shadow-emerald-600/25 transition-all hover:-translate-y-0.5 hover:bg-emerald-700">
                Create event
              </button>
            </div>
          </div>
        </section>

        <footer className="border-t border-slate-200/70">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-8 text-xs text-slate-400">
            <span className="font-display text-sm font-bold text-slate-500">Venn</span>
            <span>Free, no sign-up, no emails.</span>
          </div>
        </footer>
      </div>
    );
  }

  // --- DASHBOARD ---
  const availNow = hoveredBlock ? (allData || []).filter(d => d.block_id === hoveredBlock).map(d => d.user_name) : [];
  const uniqueList = [...new Set((allData || []).map(d => d.user_name))];
  const unavailNow = uniqueList.filter(u => !availNow.includes(u));

  return (
    <div className="min-h-screen overflow-x-hidden bg-paper p-4 font-sans text-ink select-none lg:p-8">
      <div className="mx-auto max-w-[1500px] space-y-6">

        <header className="flex flex-col gap-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm xl:flex-row xl:items-center xl:justify-between xl:p-8">
          <div className="min-w-0">
            <button
              onClick={() => { window.location.hash = ''; }}
              className="flex items-center gap-2 text-sm font-semibold text-slate-400 transition-colors hover:text-slate-700"
              title="Back to Venn home"
            >
              <span className="flex -space-x-1.5">
                <span className="block h-3.5 w-3.5 rounded-full bg-emerald-400/80 mix-blend-multiply"></span>
                <span className="block h-3.5 w-3.5 rounded-full bg-sky-400/70 mix-blend-multiply"></span>
              </span>
              Venn
            </button>
            <h1 className="mt-2 truncate font-display text-3xl font-bold tracking-tight sm:text-4xl">
              {groupInfo?.title || 'Loading…'}
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              {groupInfo ? `${new Date(groupInfo.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(groupInfo.end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${uniqueList.length} ${uniqueList.length === 1 ? 'person' : 'people'}` : ''}
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <button onClick={() => {
              const customLink = `https://life.minescout.net/projects/booking/index.html${window.location.hash}`;
              navigator.clipboard.writeText(customLink);
              alert("Link copied!");
            }}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700">
              <Share2 size={15} /> Share invite link
            </button>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500" htmlFor="dash-name">Your name</label>
              <input id="dash-name" type="text" className="w-48 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium shadow-sm focus:border-emerald-600 focus:outline-none transition-colors"
                value={userName} onChange={e => {setUserName(e.target.value); localStorage.setItem('venn_name', e.target.value);}} />
            </div>
            <div>
              <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-500" htmlFor="dash-pw">
                Password {isLockedBySomeone && <Lock size={11} className="text-emerald-600" />}
              </label>
              <input id="dash-pw" type="password" className={`w-44 rounded-xl border px-3.5 py-2.5 text-sm font-medium shadow-sm focus:outline-none transition-colors ${isLockedBySomeone && !isAuthorized ? 'border-rose-300 text-rose-600' : 'border-slate-200 focus:border-emerald-600'} bg-white`}
                value={password} onChange={e => {setPassword(e.target.value); localStorage.setItem('venn_pw', e.target.value);}} />
            </div>

            {isAuthorized && userName && (
              <div className="relative">
                <button onClick={() => setShowSecurityMenu(!showSecurityMenu)} aria-label="Settings"
                  className={`rounded-xl border p-3 shadow-sm transition-colors ${showSecurityMenu ? 'border-emerald-600 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`}>
                  <Settings size={18} />
                </button>
                {showSecurityMenu && (
                  <div className="anim-pop absolute right-0 top-16 z-50 w-80 space-y-5 rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-2xl">
                    <div className="flex items-center justify-center gap-2 text-slate-700">
                      <RefreshCw size={16} className={`text-emerald-600 ${isSyncing ? 'animate-spin' : ''}`} />
                      <h4 className="text-sm font-semibold">Calendar sync</h4>
                    </div>
                    <input type="text" placeholder="Paste calendar link or CID…" className="w-full rounded-xl border border-slate-200 bg-paper px-3.5 py-2.5 text-sm font-medium outline-none focus:border-emerald-600 transition-colors" value={calUrl} onChange={e => setCalUrl(e.target.value)} />
                    <label htmlFor="ign" className="flex cursor-pointer items-center gap-2.5 text-left text-sm font-medium text-slate-600">
                      <input type="checkbox" id="ign" checked={ignoreAllDay} onChange={e => setIgnoreAllDay(e.target.checked)} className="h-4 w-4 accent-emerald-600" />
                      Ignore all-day events
                    </label>
                    <button onClick={handleCalendarSync} disabled={isSyncing} className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-60">
                      <Zap size={15} /> {isSyncing ? 'Syncing…' : 'Sync my schedule'}
                    </button>

                    <div className="border-t border-slate-100 pt-5">
                      <div className="mb-4 flex items-center justify-center gap-2 text-slate-700">
                        <ShieldCheck size={16} className="text-emerald-600" />
                        <h4 className="text-sm font-semibold">Protect your name</h4>
                      </div>
                      {isLockedBySomeone ? (
                        <button onClick={handleRemovePassword} className="flex w-full items-center justify-center gap-2 rounded-xl bg-rose-50 py-3 text-sm font-semibold text-rose-600 transition-colors hover:bg-rose-100">
                          <XCircle size={15} /> Remove password
                        </button>
                      ) : (
                        <>
                          <button onClick={handleSetPassword} className="flex w-full items-center justify-center gap-2 rounded-xl bg-ink py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-800">
                            <Lock size={15} /> Lock with password
                          </button>
                          <p className="mt-3 text-xs leading-relaxed text-slate-400">Type a password in the bar above, then lock it here so nobody can edit under your name.</p>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </header>

        <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <button disabled={weekOffset === 0} onClick={() => setWeekOffset(v => v - 1)} aria-label="Previous week"
            className="rounded-xl border border-slate-200 p-2.5 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800 disabled:opacity-20 disabled:hover:bg-white">
            <ChevronLeft size={18} />
          </button>
          <div className="text-sm font-semibold text-slate-700">
            {weekLabel}
            <span className="ml-2 font-medium text-slate-400">Week {weekOffset + 1}</span>
          </div>
          <button disabled={(weekOffset + 1) * 7 >= DATES.length} onClick={() => setWeekOffset(v => v + 1)} aria-label="Next week"
            className="rounded-xl border border-slate-200 p-2.5 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800 disabled:opacity-20 disabled:hover:bg-white">
            <ChevronRight size={18} />
          </button>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1fr_1fr_320px]">
          <div className={`rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition-opacity sm:p-8 ${!isAuthorized ? 'pointer-events-none opacity-25' : ''}`}>
            <div className="mb-8 flex items-center justify-between">
              <div>
                <h3 className="font-display text-lg font-bold tracking-tight">My availability</h3>
                <p className="text-xs text-slate-400">Drag to paint. Start on a green block to erase.</p>
              </div>
              <div className="flex gap-1.5">
                <button onClick={handleSelectAll} className="rounded-lg border border-slate-200 p-2 text-emerald-600 transition-colors hover:border-emerald-200 hover:bg-emerald-50" title="Select all"><CheckSquare size={15} /></button>
                <button onClick={handleInvert} className="rounded-lg border border-slate-200 p-2 text-blue-600 transition-colors hover:border-blue-200 hover:bg-blue-50" title="Invert selection"><FlipHorizontal size={15} /></button>
                <button onClick={handleClearAll} className="rounded-lg border border-slate-200 p-2 text-rose-600 transition-colors hover:border-rose-200 hover:bg-rose-50" title="Clear all"><Trash2 size={15} /></button>
              </div>
            </div>
            <div className="overflow-x-auto pb-4">
              <div className="grid gap-1.5 touch-pan-y" style={{ gridTemplateColumns: `70px repeat(${currentWeekDates.length}, 1fr)` }} onMouseUp={commitDrag} onMouseLeave={() => { if (isDragging) commitDrag(); }}>
                <div />
                {currentWeekDates.map(d => (
                  <div key={d} className="pb-3 text-center">
                    <p className={`text-[11px] font-semibold ${d === todayISO ? 'text-emerald-600' : 'text-slate-400'}`}>
                      {new Date(d).toLocaleDateString('en-US', { weekday: 'short' })}
                    </p>
                    <p className={`text-sm font-bold ${d === todayISO ? 'text-emerald-700' : 'text-slate-700'}`}>
                      {new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </p>
                  </div>
                ))}
                {SLOTS.map((slot, sIdx) => (
                  <React.Fragment key={slot}>
                    <div className="self-center pr-4 text-right text-[11px] font-medium tabular-nums text-slate-300">{slot}</div>
                    {currentWeekDates.map((date, dIdx) => {
                      const bid = `${date}-${slot}`;
                      const active = myBlocksSet.has(bid);
                      const isSelected = isBlockSelected(dIdx, sIdx);

                      let cellBg = active ? 'bg-emerald-500 border-emerald-600' : 'bg-slate-100 border-slate-200/60';
                      if (isSelected) {
                        cellBg = dragAction === 'add' ? 'bg-emerald-400 border-emerald-500 z-10' : 'bg-rose-400 border-rose-500 z-10';
                      }

                      return (
                        <div
                          key={bid}
                          onMouseDown={() => handleMouseDown(dIdx, sIdx)}
                          onMouseEnter={() => handleMouseEnter(dIdx, sIdx)}
                          className={`h-8 cursor-crosshair rounded-md border shadow-sm transition-colors sm:h-9 ${cellBg}`}
                        />
                      );
                    })}
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 border-t-emerald-600 border-t-4 bg-white p-6 shadow-sm sm:p-8">
            <div className="mb-8 flex items-center justify-between">
              <div>
                <h3 className="font-display text-lg font-bold tracking-tight">Group heatmap</h3>
                <p className="text-xs text-slate-400">Hover a block to see who's free.</p>
              </div>
              <span className="flex items-center gap-1 text-[10px] font-medium text-slate-400">
                <span className="h-3 w-3 rounded-sm bg-slate-100"></span>
                {[20, 45, 70].map(o => <span key={o} className="h-3 w-3 rounded-sm" style={{ backgroundColor: `rgba(5,150,105,${o / 100})` }} />)}
                <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: 'rgba(5,150,105,1)' }}></span>
                <span className="ml-1">all</span>
              </span>
            </div>
            <div className="overflow-x-auto pb-4">
              <div className="grid gap-1.5" style={{ gridTemplateColumns: `70px repeat(${currentWeekDates.length}, 1fr)` }}>
                <div />
                {currentWeekDates.map(d => (
                  <div key={d} className="pb-3 text-center">
                    <p className={`text-[11px] font-semibold ${d === todayISO ? 'text-emerald-600' : 'text-slate-400'}`}>
                      {new Date(d).toLocaleDateString('en-US', { weekday: 'short' })}
                    </p>
                  </div>
                ))}
                {SLOTS.map((slot, sIdx) => (
                  <React.Fragment key={slot}>
                    <div className="self-center pr-4 text-right text-[11px] font-medium tabular-nums text-slate-300">{slot}</div>
                    {currentWeekDates.map(date => {
                      const bid = `${date}-${slot}`;
                      return (
                        <div key={bid} onMouseEnter={() => setHoveredBlock(bid)} onMouseLeave={() => setHoveredBlock(null)}
                          className="h-8 rounded-md border border-slate-200/60 bg-white shadow-sm transition-shadow hover:z-10 hover:shadow-md hover:ring-2 hover:ring-emerald-600/50 sm:h-9"
                          style={getHeatStyle(bid)} />
                      );
                    })}
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>

          <aside className="h-fit space-y-6 xl:sticky xl:top-8">
            <div className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
              <h3 className="font-display text-base font-bold tracking-tight">Status</h3>
              {hoveredBlock ? (
                <div className="anim-pop mt-6 space-y-6">
                  <div className="rounded-2xl bg-paper px-5 py-4">
                    <p className="text-xs font-medium text-slate-400">Selected time</p>
                    <p className="mt-0.5 font-display text-2xl font-bold tracking-tight">
                      {hoveredBlock.split('-')[3]}
                      <span className="mx-1.5 text-base font-normal text-slate-300">on</span>
                      <span className="text-lg">{new Date(hoveredBlock.split('-').slice(0, 3).join('-')).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                    </p>
                  </div>
                  <div>
                    <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                      <CheckCircle2 size={13} /> Free · {availNow.length}
                    </p>
                    <div className="space-y-2">
                      {availNow.map(u => (
                        <div key={u} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-700">
                          <div className="flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold text-white" style={{ backgroundColor: avatarColor(u) }}>
                            {u[0].toUpperCase()}
                          </div>
                          {u}
                        </div>
                      ))}
                      {availNow.length === 0 && <p className="px-1 text-xs text-slate-400">Nobody is free at this time yet.</p>}
                    </div>
                  </div>
                  {unavailNow.length > 0 && (
                    <div className="border-t border-slate-100 pt-5">
                      <p className="mb-3 text-xs font-semibold text-slate-400">Busy · {unavailNow.length}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {unavailNow.map(u => (
                          <span key={u} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-500">{u}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="mt-6 rounded-2xl border border-dashed border-slate-200 px-4 py-14 text-center">
                  <p className="text-xs font-medium leading-relaxed text-slate-400">Hover any block on the heatmap<br />to see who's free then.</p>
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

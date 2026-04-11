import React from 'react';
import Heatmap from './components/Heatmap';

function App() {
  return (
    <div className="min-h-screen py-12 px-4 font-sans">
      <div className="max-w-5xl mx-auto mb-8 text-center">
        <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-emerald-500 to-teal-700 tracking-tight">
          Venn.
        </h1>
        <p className="text-lg text-slate-600 mt-2">Find the overlap. Ditch the group chat chaos.</p>
      </div>
      
      <Heatmap />
    </div>
  );
}

export default App;
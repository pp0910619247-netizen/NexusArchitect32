'use client';
import { useState, type ChangeEvent, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { Lang } from '@/i18n';

export function SearchBox({ placeholder, lang }: { placeholder: string; lang: Lang }) {
  const [query, setQuery] = useState('');
  const router = useRouter();
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (query.trim()) router.push(`/${lang}/search?q=${encodeURIComponent(query.trim())}`); };
  return <form onSubmit={submit}><input value={query} onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)} placeholder={placeholder} className="w-full rounded border border-stone-300 bg-white p-3" /></form>;
}

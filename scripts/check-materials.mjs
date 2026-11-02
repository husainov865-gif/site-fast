// Structural check only; never proves source completeness, factual accuracy or design quality.
import fs from 'node:fs';
import path from 'node:path';

const target = path.resolve(process.argv[2] || '.');
const documents = [
  { name: 'Структура сайта.md', title: '# Структура сайта', sections: ['О проекте и бизнесе', 'Аудитория, задачи и целевое действие', 'Страницы и навигация', 'Страницы, блоки и источники структуры', 'Контент, факты и исходные материалы', 'Функции, формы и пользовательские сценарии', 'Старый сайт и перенос', 'Ограничения и критерии приёмки', 'Пожелания к публикации', 'Вопросы, противоречия и готовность', 'Источники и изменения'] },
  { name: 'Фирменный стиль.md', title: '# Фирменный стиль', sections: ['Бренд и визуальное направление', 'Логотип и варианты использования', 'Цвета и их роли', 'Шрифты и типографика', 'Композиция и визуальная иерархия', 'Фотографии, графика и иконки', 'Интерфейс и состояния', 'Мобильная версия и анимация', 'Визуальные референсы', 'Запреты, вопросы и готовность', 'Источники и изменения'] }
];
try {
  if (!fs.statSync(target).isDirectory()) throw new Error('Target must be a project folder');
  const results = documents.map(({ name, title, sections }) => {
    const errors = [], warnings = [], file = path.join(target, name);
    if (!fs.existsSync(file)) return { file: name, errors: ['Document is missing'], warnings };
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    if (!text.split(/\r?\n/).includes(title)) errors.push('Missing exact document title');
    if (!/^Версия документа:[ \t]*\S[^\r\n]*$/m.test(text)) errors.push('Missing document version');
    if (!/^Дата обновления:[ \t]*\S[^\r\n]*$/m.test(text)) errors.push('Missing update date');
    const status = text.match(/^Статус:\s*(.+)$/m)?.[1]?.trim();
    if (!['Готов к разработке', 'Черновик — есть критичные вопросы'].includes(status)) errors.push('Invalid or missing status');
    else if (status !== 'Готов к разработке') errors.push('Critical questions remain according to document status');
    const lines = text.split(/\r?\n/);
    for (const [index, section] of sections.entries()) {
      const heading = `## ${index + 1}. ${section}`;
      const acceptedHeadings = [heading];
      // Keep existing 0.2.0 documents usable without forcing a rewrite on upgrade.
      if (section === 'Страницы, блоки и источники структуры') acceptedHeadings.push('## 4. Подробная структура каждой страницы');
      const start = lines.findIndex(line => acceptedHeadings.includes(line));
      if (start < 0) { errors.push(`Missing section: ${section}`); continue; }
      let end = start + 1;
      while (end < lines.length && !/^## /.test(lines[end])) end++;
      if (!lines.slice(start + 1, end).join('\n').trim()) errors.push(`Empty section: ${section}`);
    }
    if (/\[ЗАПОЛНИТЬ[^\]]*\]/i.test(text)) errors.push('Unfilled template instructions remain');
    if (text.includes('[НЕ ПРЕДОСТАВЛЕНО]')) warnings.push('Missing information is marked; agent must assess whether critical');
    if (text.includes('[ПРОТИВОРЕЧИЕ]')) warnings.push('Conflicts are marked; unresolved critical conflicts must block development');
    return { file: name, status, errors, warnings };
  });
  const report = { audit: 'materials-structure', errors: results.reduce((sum, r) => sum + r.errors.length, 0), limits: 'Checks headings, content presence, statuses and template markers only. Does not validate factual accuracy, source coverage, decisions or readiness semantics.', results };
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.errors ? 1 : 0;
} catch (error) { console.error(error.message); process.exitCode = 2; }

// PF-0112 Phase 2 (owner Checkpoint D, SRC-0060): Arabic for the execution messages the
// console shows. Each server message is English (CLI and logs stay English); the console adds an
// Arabic copy next to it (`textAr`, `messageAr`, `reasonAr`) and shows that one in the Arabic UI.
// Phrases are replaced wherever they occur, so composed messages (several reasons joined) are
// translated piece by piece; names, paths, ids and commands inside them are kept as they are.
// Anything without a rule stays English: the console shows it left-to-right under an Arabic
// heading, never mixed into an Arabic sentence. test/execution-arabic.test.js lists every message.
const R = (pattern, arabic) => [new RegExp(pattern, 'g'), arabic];
const ANY = '([^]*?)';

const RULES = [
  // ----- readiness (review.js) -----
  R(`This lane has no work item to integrate\\.`, 'المسار ده مفيهوش شغلانة تتدمج.'),
  R(`Not DONE yet: ${ANY}\\.(?=\\s|$)`, 'لسه ما خلصتش (DONE): $1.'),
  R(`The latest verification of a work item failed\\.`, 'آخر تحقق لشغلانة فشل.'),
  R(`^DONE: ${ANY}\\.$`, 'خلصت (DONE): $1.'),
  R(`An agent session is running or waiting in this lane\\. End it first; the lane is then locked for review\\.`, 'فيه جلسة وكيل شغالة أو مستنية في المسار ده. اقفلها الأول؛ بعدها المسار بيتقفل للمراجعة.'),
  R(`An agent session is running or waiting in this lane\\. End it first\\.`, 'فيه جلسة وكيل شغالة أو مستنية في المسار ده. اقفلها الأول.'),
  R(`No agent is working in the lane\\.`, 'مفيش وكيل شغال في المسار.'),
  R(`Integrate by hand\\.`, 'ادمج بإيدك.'),
  R(`This repository uses Git filters or merge drivers; YallaFlow 1\\.5\\.0 does not run them\\.`, 'المستودع ده بيستخدم Git filters أو merge drivers، وYallaFlow 1.5.0 مبيشغّلهمش.'),
  R(`Use manual Git worktrees instead\\.`, 'استخدم Git worktrees بإيدك بدل كده.'),
  R(`The repository Git configuration changed since this lane was created\\. Review it; then integrate by hand\\.`, 'إعدادات Git في المستودع اتغيرت من ساعة ما المسار اتعمل. راجعها، وبعدين ادمج بإيدك.'),
  R(`The repository Git configuration changed since this lane was created; review it, then clean up by hand\\.`, 'إعدادات Git في المستودع اتغيرت من ساعة ما المسار اتعمل. راجعها، وبعدين نضّف بإيدك.'),
  R(`Git is busy in the main checkout \\(${ANY}\\)\\.`, 'Git مشغول في المشروع الأساسي ($1).'),
  R(`Git is busy in the lane \\(${ANY}\\)\\.`, 'Git مشغول في المسار ($1).'),
  R(`The main checkout must be on ${ANY}\\.(?=\\s|$)`, 'المشروع الأساسي لازم يكون على $1.'),
  R(`${ANY} has invisible control or direction characters in its name; rename it, or integrate by hand\\.`, '$1 في اسمه حروف تحكم أو اتجاه مش ظاهرة؛ غيّر اسمه، أو ادمج بإيدك.'),
  R(`${ANY} is a submodule change; integrate by hand\\.`, '$1 تغيير في submodule؛ ادمج بإيدك.'),
  R(`${ANY} is a symbolic link pointing outside the repository\\.`, '$1 لينك بيشاور لبرا المستودع.'),
  R(`Not included unless you tick them: ${ANY} \\(they look like secrets\\)\\.`, 'مش هيتضافوا إلا لو علّمت عليهم: $1 (شكلهم فيه أسرار).'),
  R(`Already committed in the lane and looks like a secret: ${ANY}\\. Tick it to merge it anyway, or remove it from the lane's commits yourself\\.`, 'الوكيل عمله commit في المسار وشكله فيه أسرار: $1. علّم عليه لو عايز تدمجه برضه، أو شيله من الـ commits بتاعة المسار بنفسك.'),
  R(`The lane's commits add something that looks like a secret: ${ANY}\\. It would be in ${ANY}'s history even if the file changed later\\. Tick it to merge anyway, or rewrite the lane's commits yourself\\.`, 'الـ commits بتاعة المسار بتضيف حاجة شكلها سر: $1. هتفضل في تاريخ $2 حتى لو الملف اتغير بعدين. علّم عليها لو عايز تدمج برضه، أو أعد كتابة الـ commits بتاعة المسار بنفسك.'),
  R(`The checks run in the lane together with files Git ignores, which this review does not show: ${ANY}\\. Programs in them \\(for example node_modules/\\.bin\\) run with your permissions\\.`, 'الفحوص بتشتغل في المسار ومعاها ملفات Git متجاهلها، والمراجعة دي مبتعرضهاش: $1. البرامج اللي فيها (زي node_modules/.bin) بتشتغل بصلاحياتك.'),
  R(`The files Git ignores in the lane changed since you approved \\(${ANY}\\)\\. Review it again\\.`, 'الملفات اللي Git متجاهلها في المسار اتغيرت من ساعة ما وافقت ($1). راجعه تاني.'),
  R(`${ANY} of the lane's commit messages or author fields look like they hold a secret\\. Rewrite the lane's commits yourself, or integrate by hand\\.`, '$1 من رسايل الـ commits أو بيانات الكاتب في المسار شكلها فيها سر. أعد كتابة الـ commits بتاعة المسار بنفسك، أو ادمج بإيدك.'),
  R(`The lane commit message \\(from the work titles\\) has invisible characters or looks like it holds a secret\\. Fix the work title, then review again\\.`, 'رسالة الـ commit بتاعة المسار (من عناوين الشغل) فيها حروف مش ظاهرة أو شكلها فيها سر. صلّح عنوان الشغلانة، وبعدين راجع تاني.'),
  R(`Files under \\.yallaflow/local/ are tracked by Git in the lane \\(${ANY}\\); that folder is personal state\\. Remove them from Git by hand, then review again\\.`, 'فيه ملفات تحت .yallaflow/local/ متتبَّعة في Git في المسار ($1)؛ الفولدر ده حالة شخصية. شيلها من Git بإيدك، وبعدين راجع تاني.'),
  R(`Automated merge is off for this task: the checks would run next to files Git ignores in the lane \\(${ANY}\\), which the lane's agent controls and this review does not show\\. YallaFlow never runs them with your permissions\\. Merge by hand instead, or remove those files from the lane and review again\\.`, 'الدمج الآلي مقفول للمهمة دي: الفحوص كانت هتشتغل جنب ملفات Git متجاهلها في المسار ($1)، والوكيل هو اللي متحكم فيها والمراجعة دي مبتعرضهاش. YallaFlow عمره ما بيشغّلها بصلاحياتك. ادمج بإيدك بدل كده، أو شيل الملفات دي من المسار وراجع تاني.'),
  R(`No check can run on the merged result: declare a merge check \\(yallaflow execution checks set\\)\\. Commands the agent ran in its own session are not run by YallaFlow\\.`, 'مفيش فحص ممكن يشتغل على نتيجة الدمج: حدّد فحص دمج (yallaflow execution checks set). الأوامر اللي الوكيل شغّلها في جلسته YallaFlow مبيشغّلهاش.'),
  R(`Files Git ignores appeared in the lane \\(${ANY}\\); the checks would run next to them\\. ${ANY} is unchanged\\. Merge by hand instead\\.`, 'ظهرت ملفات Git متجاهلها في المسار ($1)؛ الفحوص كانت هتشتغل جنبها. $2 متغيرش. ادمج بإيدك بدل كده.'),
  R(`Only the project's declared merge checks run; ${ANY} is unchanged\\.`, 'بس فحوص الدمج المعلنة للمشروع هي اللي بتشتغل؛ $1 متغيرش.'),
  R(`Automated merge is turned off in YallaFlow 1\\.5\\.0: its checks cannot yet run on exactly the merged content apart from files the lane's agent controls\\. Merge by hand with the steps shown\\.`, 'الدمج الآلي مقفول في YallaFlow 1.5.0: فحوصه لسه ميقدرش يشغّلها على اللي هيتدمج بالظبط بعيد عن ملفات وكيل المسار متحكم فيها. ادمج بإيدك بالخطوات اللي ظاهرة.'),
  R(`The lane has a folder named \\.git inside it \\(${ANY}\\); Git cannot see its files, so Clean up could delete them\\. Move it out of the lane yourself first\\.`, 'المسار جواه فولدر اسمه .git ($1)؛ Git مش شايف ملفاته، فالتنضيف ممكن يمسحها. انقله برا المسار بنفسك الأول.'),
  R(`Use the home project for this action, not a lane\\.`, 'استخدم المشروع الأساسي للأمر ده، مش المسار.'),
  R(`Use the home project for this, not a lane\\.`, 'استخدم المشروع الأساسي للحاجة دي، مش المسار.'),
  R(`Parallel is turned off in YallaFlow 1\\.5\\.0 until a real-agent test confirms that a lane's agent cannot change your repository's shared Git settings or the agent settings the console loads\\. Run tasks one after another with a queue instead\\.`, 'التشغيل المتوازي مقفول في YallaFlow 1.5.0 لحد ما تجربة بوكيل حقيقي تأكد إن وكيل المسار ميقدرش يغيّر إعدادات Git المشتركة في مشروعك أو إعدادات الوكيل اللي الكونسول بيحمّلها. شغّل المهام ورا بعض بطابور بدل كده.'),
  R(`${ANY} was not started: the project's agent configuration changed since this queue began\\. Look at it, then start the task yourself\\.`, '$1 ما بدأتش: إعدادات الوكيل في المشروع اتغيرت من ساعة ما الطابور بدأ. بص عليها، وبعدين ابدأ المهمة بنفسك.'),
  R(`Files you leave out stay in the lane, so the checks would not run on exactly what is merged: ${ANY}\\. Tick them, or move them out of the lane \\(or add them to \\.gitignore\\) first\\.`, 'الملفات اللي بتشيل العلامة من عليها بتفضل في المسار، فالفحوص مش هتشتغل على اللي هيتدمج بالظبط: $1. علّم عليها، أو انقلها برا المسار (أو ضيفها لـ .gitignore) الأول.'),
  R(`The merge preview failed: `, 'معاينة الدمج فشلت: '),
  R(`Conflicts with ${ANY}: ${ANY}\\.$`, 'فيه تعارض مع $1: $2.'),
  R(`No conflicts with ${ANY} @ ${ANY}\\.$`, 'مفيش تعارض مع $1 @ $2.'),
  R(`This project has Git hooks or CI \\(${ANY}\\)\\. Declare the required merge checks first \\(yallaflow execution checks set\\); YallaFlow does not assume task tests replace them\\.`, 'المشروع ده فيه Git hooks أو CI ($1). حدّد فحوص الدمج المطلوبة الأول (yallaflow execution checks set)؛ YallaFlow مش بيفترض إن اختبارات المهمة بتغني عنها.'),
  R(`No check would run on the merged result: tick a command the agent recorded \\(it runs with your permissions\\), or declare a merge check \\(yallaflow execution checks set\\)\\.`, 'مفيش فحص هيشتغل على نتيجة الدمج: علّم على أمر سجّله الوكيل (بيشتغل بصلاحياتك)، أو حدّد فحص دمج (yallaflow execution checks set).'),
  R(`No check can run on the merged result: declare a merge check \\(yallaflow execution checks set\\)\\.`, 'مفيش فحص ممكن يشتغل على نتيجة الدمج: حدّد فحص دمج (yallaflow execution checks set).'),
  R(`Will run on the merged result before ${ANY} moves: ${ANY}\\.$`, 'هيشتغل على نتيجة الدمج قبل ما $1 يتحرك: $2.'),
  R(`Your main checkout has staged changes\\. Commit or unstage them first; YallaFlow never commits them\\.`, 'المشروع الأساسي عندك فيه تغييرات staged. اعملها commit أو شيلها من الـ stage الأول؛ YallaFlow عمره ما بيعملها commit.'),
  R(`Your uncommitted files would be changed by the merge: ${ANY}\\.(?=\\s|$)`, 'ملفاتك اللي لسه مش متعمل لها commit هتتغير بالدمج: $1.'),
  R(`assume-unchanged or skip-worktree files would be changed: ${ANY}\\.(?=\\s|$)`, 'ملفات عليها assume-unchanged أو skip-worktree هتتغير: $1.'),
  R(`${ANY} exists in your main checkout \\(ignored or untracked\\) and the merge adds it; it would be overwritten\\.`, '$1 موجود في المشروع الأساسي (متجاهَل أو مش متتبَّع) والدمج بيضيفه؛ كان هيتكتب فوقه.'),
  R(`YallaFlow files it will update after the merge are not clean: ${ANY}\\.(?=\\s|$)`, 'ملفات YallaFlow اللي هيحدّثها بعد الدمج مش نضيفة: $1.'),
  R(`Your ${ANY} unrelated uncommitted file\\(s\\) stay untouched\\.`, 'ملفاتك التانية ($1) اللي لسه مش متعمل لها commit مش هتتلمس.'),
  R(`The main checkout is clean\\.`, 'المشروع الأساسي نضيف.'),

  R(`This repository has submodules \\(${ANY}\\); YallaFlow 1\\.5\\.0 does not automate merges with submodules\\.`, 'المستودع ده فيه submodules ($1)؛ YallaFlow 1.5.0 مبيعملش دمج آلي مع submodules.'),
  R(`This repository has submodules \\(${ANY}\\); YallaFlow 1\\.5\\.0 does not create lanes for it\\.`, 'المستودع ده فيه submodules ($1)؛ YallaFlow 1.5.0 مبيعملش له مسارات.'),
  R(`This repository has submodules \\(${ANY}\\)\\. YallaFlow 1\\.5\\.0 does not automate lanes or merges with submodules; use the manual Git steps instead\\.`, 'المستودع ده فيه submodules ($1). YallaFlow 1.5.0 مبيعملش مسارات أو دمج آلي مع submodules؛ استخدم خطوات Git اليدوية بدل كده.'),
  R(`The lane has submodules \\(${ANY}\\); YallaFlow 1\\.5\\.0 does not clean up lanes with submodules\\. Remove it by hand\\.`, 'المسار فيه submodules ($1)؛ YallaFlow 1.5.0 مبينضفش مسارات فيها submodules. شيله بإيدك.'),

  // ----- the merge (merge.js) -----
  R(`Tick the confirmation: it approves the commit, the merge and running the listed checks\\.`, 'علّم على التأكيد: ده موافقة على الـ commit والدمج وتشغيل الفحوص اللي فوق.'),
  R(`What would be merged changed since you reviewed it\\. Review it again\\.`, 'اللي هيتدمج اتغير من ساعة ما راجعته. راجعه تاني.'),
  R(`What would be merged changed since you approved it \\(D8\\)\\. Review it again\\.`, 'اللي هيتدمج اتغير من ساعة ما وافقت عليه. راجعه تاني.'),
  R(`A merge record in \\.yallaflow/local/execution/merges/ is unreadable; look at it first\\.`, 'فيه سجل دمج في .yallaflow/local/execution/merges/ مش مقروء؛ بص عليه الأول.'),
  R(`This lane already has a merge that is not finished\\. Continue it or abandon it first\\.`, 'المسار ده عليه دمج لسه ما خلصش. كمّله أو سيبه الأول.'),
  R(`Another YallaFlow console \\(pid ${ANY}\\) is merging in this project\\.`, 'فيه كونسول YallaFlow تاني (pid $1) بيدمج في المشروع ده.'),
  R(`The merge lock could not be taken\\.`, 'معرفتش آخد قفل الدمج.'),
  R(`The lane moved since you approved it\\.`, 'المسار اتحرك من ساعة ما وافقت.'),
  R(`The lane's staged content differs from what you approved \\(something else is staged there\\); nothing was committed\\.`, 'المحتوى الـ staged في المسار مختلف عن اللي وافقت عليه (فيه حاجة تانية staged هناك)؛ مفيش commit اتعمل.'),
  R(`${ANY} moved since you approved \\(D8\\)\\. Review it again\\.`, '$1 اتحرك من ساعة ما وافقت. راجع تاني.'),
  R(`${ANY} moved since you approved \\(D8\\)\\.`, '$1 اتحرك من ساعة ما وافقت.'),
  R(`The merged result differs from what you approved\\.`, 'نتيجة الدمج مختلفة عن اللي وافقت عليه.'),
  R(`^Conflicts: ${ANY}\\.$`, 'تعارضات: $1.'),
  R(`The lane has files that are not part of the merge \\(${ANY}\\); the checks would not run on exactly what is merged\\. ${ANY} is unchanged\\.`, 'المسار فيه ملفات مش جزء من الدمج ($1)؛ الفحوص مش هتشتغل على اللي هيتدمج بالظبط. $2 متغيرش.'),
  R(`The lane is not at the merge commit\\.`, 'المسار مش واقف على commit الدمج.'),
  R(`The check "${ANY}" failed on the merged result \\(exit ${ANY}\\); ${ANY} is unchanged\\.`, 'الفحص "$1" فشل على نتيجة الدمج (exit $2)؛ $3 متغيرش.'),
  R(`Knowledge preview failed: `, 'معاينة المعرفة فشلت: '),
  R(`Knowledge from this lane conflicts with project memory changed in parallel: ${ANY}\\.$`, 'المعرفة اللي في المسار ده بتتعارض مع ذاكرة المشروع اللي اتغيرت بالتوازي: $1.'),
  R(`The knowledge that would integrate differs from what you reviewed\\.`, 'المعرفة اللي هتتدمج مختلفة عن اللي راجعته.'),
  R(`The main checkout is no longer on ${ANY}\\.$`, 'المشروع الأساسي مبقاش على $1.'),
  R(`Some of your unrelated uncommitted files changed during the fast-forward; stopped\\. Check them before doing anything else\\.`, 'شوية من ملفاتك التانية اللي مش متعمل لها commit اتغيرت أثناء الـ fast-forward؛ وقفت. بص عليها قبل أي حاجة تانية.'),
  R(`did not pass after the merge: `, 'ما عدّاش بعد الدمج: '),
  R(`The main checkout is not at the merged result\\.`, 'المشروع الأساسي مش واقف على نتيجة الدمج.'),
  R(`YallaFlow files changed in your main checkout during the merge \\(${ANY}\\); the code merge stands\\. Commit or undo those edits, then continue\\.`, 'ملفات YallaFlow اتغيرت في المشروع الأساسي أثناء الدمج ($1)؛ دمج الكود ثابت. اعمل للتعديلات دي commit أو رجّعها، وبعدين كمّل.'),
  R(`Knowledge integration found a parallel change; the code merge stands\\. Revalidate the knowledge\\.`, 'دمج المعرفة لقى تغيير اتعمل بالتوازي؛ دمج الكود ثابت. اتأكد من المعرفة تاني.'),
  R(`The knowledge integrated differs from the preview; nothing was committed\\.`, 'المعرفة اللي اتدمجت مختلفة عن المعاينة؛ مفيش commit اتعمل.'),
  R(`${ANY} changed after YallaFlow wrote its records; the knowledge commit was not made\\. Look at it first\\.`, '$1 اتغير بعد ما YallaFlow كتب سجلاته؛ commit المعرفة ما اتعملش. بص عليه الأول.'),
  R(`Something else is staged in your main checkout; the knowledge commit was not made\\.`, 'فيه حاجة تانية staged في المشروع الأساسي؛ commit المعرفة ما اتعملش.'),
  R(`The knowledge commit touched a file outside YallaFlow's own records\\.`, 'commit المعرفة لمس ملف برا سجلات YallaFlow.'),
  R(`The integration record in your working tree is not committed and the merge is not verified; do not commit it by hand\\.`, 'سجل الدمج اللي في ملفاتك متعملهوش commit والدمج مش متحقَّق منه؛ ما تعملوش commit بإيدك.'),
  R(`The console stopped during the merge\\. Continue re-checks everything first\\.`, 'الكونسول وقف في نص الدمج. «كمّل» بيراجع كل حاجة الأول.'),
  R(`Abandoned by you; nothing was undone\\.`, 'سبته إنت؛ مفيش حاجة اترجعت لورا.'),
  R(`If you want to undo the merge yourself: `, 'لو عايز ترجّع الدمج بنفسك: '),
  R(`This merge stopped on something YallaFlow cannot check again safely; look at the reason, then abandon it\\.`, 'الدمج ده وقف على حاجة YallaFlow ميقدرش يراجعها تاني بأمان؛ بص على السبب، وبعدين سيبه.'),
  R(`This merge record is unreadable; look at it in \\.yallaflow/local/execution/merges/ yourself\\.`, 'سجل الدمج ده مش مقروء؛ بص عليه في .yallaflow/local/execution/merges/ بنفسك.'),
  R(`^This merge is ${ANY}\\.$`, 'الدمج ده حالته $1.'),
  R(`^Unknown merge\\.$`, 'دمج مش معروف.'),

  // ----- lanes (lanes.js, server) -----
  R(`Parallel lanes need Shared Project Mode in a committed config: enable it, commit \\.yallaflow/, then create lanes\\.`, 'المسارات المتوازية محتاجة Shared Project Mode متسجّل في commit: شغّله، اعمل commit لـ .yallaflow/، وبعدين اعمل المسارات.'),
  R(`Create lanes from the integration branch \\(${ANY}\\); this checkout is on ${ANY}\\.$`, 'اعمل المسارات من الفرع الأساسي ($1)؛ المشروع ده دلوقتي على $2.'),
  R(`Lanes start from a commit: `, 'المسارات بتبدأ من commit: '),
  R(`At most ${ANY} lanes at a time \\(${ANY} open\\)\\.`, 'بالكتير $1 مسار في نفس الوقت ($2 مفتوحين).'),
  R(`This folder has no matching YallaFlow lane marker; YallaFlow only removes lanes it created\\.`, 'الفولدر ده مفيهوش علامة مسار YallaFlow مطابقة؛ YallaFlow بيشيل بس المسارات اللي هو عملها.'),
  R(`Another YallaFlow console \\(pid ${ANY}\\) owns this lane\\.`, 'فيه كونسول YallaFlow تاني (pid $1) ماسك المسار ده.'),
  R(`Git hides changes to ${ANY} file\\(s\\) here \\(assume-unchanged or skip-worktree\\): ${ANY}\\. Clean up cannot see whether they changed; clear those flags yourself first\\.`, 'Git مخبّي تغييرات في $1 ملف هنا (assume-unchanged أو skip-worktree): $2. التنضيف ميقدرش يشوف إذا كانوا اتغيروا؛ شيل العلامات دي بنفسك الأول.'),
  R(`The lane has ${ANY} staged, unstaged or untracked change\\(s\\): ${ANY}\\.$`, 'المسار فيه $1 تغيير staged أو unstaged أو مش متتبَّع: $2.'),
  R(`${ANY} is ignored by Git but is not a reproducible dependency; Clean up would delete it\\. Move or delete it yourself first\\.`, '$1 متجاهَل في Git بس مش اعتمادية ممكن تتنزّل تاني؛ التنضيف كان هيمسحه. انقله أو امسحه بنفسك الأول.'),
  R(`The lane's branch is not merged into ${ANY}; its work would only remain on ${ANY}\\.$`, 'فرع المسار مش متدمج في $1؛ شغله كان هيفضل بس على $2.'),
  R(`The lane is merged but not verified yet\\.`, 'المسار اتدمج بس لسه ما اتحققش منه.'),
  R(`The files Clean up would delete changed since you confirmed them; review the list again\\.`, 'الملفات اللي التنضيف هيمسحها اتغيرت من ساعة ما أكدتها؛ راجع القايمة تاني.'),
  R(`Files appeared in the lane since you confirmed Clean up \\(${ANY}\\); nothing was deleted\\. Review it again\\.`, 'ظهرت ملفات في المسار من ساعة ما أكدت التنضيف ($1)؛ مفيش حاجة اتمسحت. راجعه تاني.'),
  R(`${ANY} is no longer a worktree of ${ANY}; YallaFlow stopped without running Git there\\.`, '$1 مبقاش worktree تبع $2؛ YallaFlow وقف من غير ما يشغّل Git هناك.'),
  R(`^Unknown lane\\.$`, 'مسار مش معروف.'),
  R(`Open the lane in this console first\\.`, 'افتح المسار في الكونسول ده الأول.'),
  R(`This lane has no conflict to send back\\.`, 'المسار ده مفيهوش تعارض يترجع.'),
  R(`Confirm sending the conflict back to the lane's agent\\.`, 'أكّد إنك عايز ترجّع التعارض لوكيل المسار.'),
  R(`An agent session is running in the lane\\. End it first\\.`, 'فيه جلسة وكيل شغالة في المسار. اقفلها الأول.'),
  R(`Integrate this lane by hand instead\\.`, 'ادمج المسار ده بإيدك بدل كده.'),
  R(`The integration branch name is not a plain branch name; send the conflict back by hand\\.`, 'اسم الفرع الأساسي مش اسم فرع عادي؛ رجّع التعارض بإيدك.'),
  R(`Create lanes from the home project, not from a lane\\.`, 'اعمل المسارات من المشروع الأساسي، مش من مسار.'),
  R(`${ANY} is not in the last commit; commit it first \\(a lane starts from that commit\\), or run it here with Start or a queue\\.`, '$1 مش موجودة في آخر commit؛ اعملها commit الأول (المسار بيبدأ من الـ commit ده)، أو شغّلها هنا بـ «ابدأ» أو بطابور.'),
  R(`An agent session is running in this project\\. End it first\\.`, 'فيه جلسة وكيل شغالة في المشروع ده. اقفلها الأول.'),
  R(`Commit or set aside the uncommitted YallaFlow changes first \\(${ANY}\\)\\.`, 'اعمل commit لتغييرات YallaFlow اللي لسه مش متعمل لها commit أو شيلها على جنب الأول ($1).'),

  // ----- the queue (manager.js, server) -----
  R(`This project's runs file is unreadable \\(${ANY}\\); fix or remove \\.yallaflow/local/execution/runs\\.json first\\.`, 'ملف التشغيل بتاع المشروع ده مش مقروء ($1)؛ صلّحه أو امسح .yallaflow/local/execution/runs.json الأول.'),
  R(`runs\\.json was not written by YallaFlow here \\(${ANY}\\)`, 'runs.json ما اتكتبش هنا بـ YallaFlow ($1)'),
  R(`Choose 1 to ${ANY} work items\\.`, 'اختار من 1 لـ $1 شغلانة.'),
  R(`Each work item may appear once, by its id\\.`, 'كل شغلانة تظهر مرة واحدة بس، برقمها.'),
  R(`Choose one of: ${ANY}\\.$`, 'اختار واحد من: $1.'),
  R(`${ANY} already belongs to an unfinished run\\.`, '$1 تبع تشغيل لسه ما خلصش.'),
  R(`${ANY} is not a work item of this project\\.`, '$1 مش شغلانة في المشروع ده.'),
  R(`${ANY} is already DONE\\.`, '$1 خلصت (DONE) بالفعل.'),
  R(`${ANY} is closed\\.`, '$1 مقفولة.'),
  R(`${ANY} is on hold\\.`, '$1 متوقفة مؤقتاً.'),
  R(`${ANY} has a session running now\\. Let it finish or end it first\\.`, '$1 عليها جلسة شغالة دلوقتي. سيبها تخلص أو اقفلها الأول.'),
  R(`^Unknown run\\.$`, 'تشغيل مش معروف.'),
  R(`^Unknown action\\.$`, 'أمر مش معروف.'),
  R(`^Unknown task\\.$`, 'مهمة مش معروفة.'),
  R(`Only an interrupted or paused task can be resumed\\.`, 'تقدر تكمّل بس مهمة اتقطعت أو متوقفة.'),
  R(`Start this task in ${ANY} and link it; the console cannot start it\\.`, 'ابدأ المهمة دي في $1 واربطها؛ الكونسول ميقدرش يبدأها.'),
  R(`Another session is running in this checkout\\. End it first\\.`, 'فيه جلسة تانية شغالة في المشروع ده. اقفلها الأول.'),
  R(`Only a failed, paused or interrupted task can be retried\\.`, 'تقدر تعيد بس مهمة فشلت أو متوقفة أو اتقطعت.'),
  R(`Stop the running task first\\.`, 'وقّف المهمة الشغالة الأول.'),
  R(`This task cannot be skipped\\.`, 'المهمة دي متتعدّاش.'),
  R(`Send every queued task exactly once\\.`, 'ابعت كل مهمة في الطابور مرة واحدة بالظبط.'),
  R(`Confirm stopping the run now\\.`, 'أكّد إنك عايز توقف التشغيل دلوقتي.'),
  R(`Tick the confirmation to start the run\\.`, 'علّم على التأكيد علشان التشغيل يبدأ.'),
  R(`Tick the confirmation first\\.`, 'علّم على التأكيد الأول.'),
  R(`${ANY} was not started: its claim could not be saved \\(${ANY}\\)\\.`, '$1 ما بدأتش: معرفتش أحفظ إنها بدأت ($2).'),
  R(`${ANY} was not started: its state could not be read from YallaFlow\\.`, '$1 ما بدأتش: معرفتش أقرا حالتها من YallaFlow.'),
  R(`runs could not be saved: `, 'معرفتش أحفظ التشغيل: '),

  // ----- Git (git-ops.js) -----
  R(`Git is not available\\.`, 'Git مش موجود.'),
  R(`Git ${ANY} is older than ${ANY}\\.(?=\\s|$)`, 'Git $1 أقدم من $2.'),
  R(`Automated Git operations are verified on Linux only; this is ${ANY}\\.(?=\\s|$)`, 'عمليات Git الآلية متجرّبة على Linux بس؛ ده $1.'),
  R(`Automated Git operations are verified with Git ${ANY}; this is Git ${ANY}\\.(?=\\s|$)`, 'عمليات Git الآلية متجرّبة مع Git $1؛ ده Git $2.'),
  R(`Use the manual Git steps instead\\.`, 'استخدم خطوات Git اليدوية بدل كده.'),
  R(`This repository uses ${ANY}\\. YallaFlow 1\\.5\\.0 never runs repository-defined Git filters or merge drivers; use the manual Git steps instead\\.`, 'المستودع ده بيستخدم $1. YallaFlow 1.5.0 عمره ما بيشغّل Git filters أو merge drivers متعرّفة في المستودع؛ استخدم خطوات Git اليدوية بدل كده.'),
  R(`A file name in the lane's commits cannot be read exactly; YallaFlow 1\\.5\\.0 cannot review it\\. Rename it, or commit and merge by hand\\.`, 'فيه اسم ملف في الـ commits بتاعة المسار مينفعش يتقري بالظبط؛ YallaFlow 1.5.0 ميقدرش يراجعه. غيّر اسمه، أو اعمل commit وادمج بإيدك.'),
  R(`A file name here is not valid UTF-8; YallaFlow 1\\.5\\.0 cannot review it exactly\\. Rename it, or commit and merge by hand\\.`, 'فيه اسم ملف هنا مش UTF-8 سليم؛ YallaFlow 1.5.0 ميقدرش يراجعه بالظبط. غيّر اسمه، أو اعمل commit وادمج بإيدك.'),
  R(`Commits here are signed with ${ANY}; YallaFlow 1\\.5\\.0 signs only with SSH or OpenPGP\\. Commit and merge by hand\\.`, 'الـ commits هنا بتتوقّع بـ $1؛ YallaFlow 1.5.0 بيوقّع بـ SSH أو OpenPGP بس. اعمل commit وادمج بإيدك.'),
  R(`The staged content differs from what you approved; nothing was committed\\.`, 'المحتوى الـ staged مختلف عن اللي وافقت عليه؛ مفيش commit اتعمل.'),
  R(`The new commit does not match the approved content; stopped without changing anything else\\.`, 'الـ commit الجديد مش مطابق للمحتوى اللي وافقت عليه؛ وقفت من غير ما أغيّر حاجة تانية.'),
  R(`The created commit does not carry the expected tree\\.`, 'الـ commit اللي اتعمل مش شايل الـ tree المتوقع.'),
  R(`Git is busy in ${ANY} \\(${ANY}\\); nothing was changed\\. Finish or clear that yourself, then continue\\.`, 'Git مشغول في $1 ($2)؛ مفيش حاجة اتغيرت. خلّص ده أو شيله بنفسك، وبعدين كمّل.'),
  R(`After the fast-forward, ${ANY} is not exactly at ${ANY} \\(another Git process may be running here\\)\\. Stopped; nothing is repaired automatically\\.`, 'بعد الـ fast-forward، $1 مش واقف بالظبط على $2 (ممكن يكون فيه عملية Git تانية شغالة هنا). وقفت؛ مفيش حاجة بتتصلح لوحدها.'),
  R(`${ANY} already exists\\.$`, '$1 موجود بالفعل.'),
  R(`The branch ${ANY} already exists\\.`, 'الفرع $1 موجود بالفعل.'),
  R(`git ${ANY} failed: `, 'أمر git $1 فشل: '),
  R(`git ${ANY} could not run: `, 'أمر git $1 ما اشتغلش: '),

  // ----- console guards -----
  R(`^Unknown project\\.$`, 'مشروع مش معروف.'),
  R(`The console is still starting\\.`, 'الكونسول لسه بيبدأ.'),
  R(`^Turn agents on first\\.$`, 'شغّل الوكلاء الأول.'),
  R(`The body must be a JSON object\\.`, 'الطلب لازم يكون JSON object.'),
  // Generic endings last, after every longer sentence that contains them.
  R(`Nothing was changed\\.`, 'مفيش حاجة اتغيرت.'),
  R(`nothing was changed\\.`, 'مفيش حاجة اتغيرت.')
];

// → the Arabic copy of an execution message, or null when nothing in it has a rule.
export function toArabic(text) {
  if (typeof text !== 'string' || !text) return null;
  let out = text;
  for (const [pattern, arabic] of RULES) out = out.replace(pattern, arabic);
  return out === text ? null : out;
}

// Adds `textAr` / `messageAr` / `reasonAr` next to the English fields of a response, in place.
export function withArabic(value) {
  if (Array.isArray(value)) { for (const item of value) withArabic(item); return value; }
  if (!value || typeof value !== 'object') return value;
  for (const [key, arabicKey] of [['text', 'textAr'], ['message', 'messageAr'], ['reason', 'reasonAr'], ['detail', 'detailAr'], ['storeError', 'storeErrorAr']]) {
    if (typeof value[key] === 'string') { const ar = toArabic(value[key]); if (ar) value[arabicKey] = ar; }
  }
  for (const key of ['readiness', 'blockers', 'merges', 'steps', 'lanes', 'cleanup', 'preconditions', 'error']) if (value[key] && typeof value[key] === 'object') withArabic(value[key]);
  return value;
}

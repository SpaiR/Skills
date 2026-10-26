# Фидбек по ревью: Строже проверка ревизий и мягче лимиты гайда

- Диапазон: main...HEAD + незакоммиченное
- Репозиторий: `/private/var/folders/fp/m6vmxbdx6bv9bz1w82wbt7m00000gp/T/tmp.lL2xfNTRvG/harness/mixed-repo`, ветка `feature/review-polish`

## Общий комментарий

В целом хорошо.
Но есть вопросы.

## Глава 2. Валидатор: подробные ошибки и больше глав

Глава про валидатор — ок.

## `scripts/collect.py`, строки 54–58 (новая версия)

```diff
+    """Возвращает полный sha или None, если ревизия не найдена."""
+    res = git(root, "rev-parse", "--verify", "--quiet", f"{ref}^{{{kind}}}", check=False)
+    if res.returncode != 0:
+        return None
+    return res.stdout.decode().strip() or None
```

Слишком сложно

Предложенная замена:

````suggestion
return verify_simple(root, ref)
```inner```
````

## `scripts/validate.py`, строка 16 (новая версия)

```diff
+MAX_SECTIONS = 12
```

Почему 12?
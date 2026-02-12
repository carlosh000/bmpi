# Resolver conflictos de rama (attendance-list.component.ts, attendance.service.ts, backend/main.go)

Si GitHub te marca conflicto en PR (aunque local compile), normalmente tu rama está desfasada respecto a la rama destino.

## 1) Traer rama destino y rebase

```bash
git remote -v
git fetch origin
# cambia `main` por la rama destino real de tu PR

git checkout <tu-rama>
git rebase origin/main
```

## 2) Resolver archivos en conflicto (si aparecen)

```bash
git status
# edita estos archivos si salen en unmerged:
# - attendance-web/src/app/attendance-list.component.ts
# - attendance-web/src/app/attendance.service.ts
# - backend/main.go
```

Busca y elimina marcadores:

```text
<<<<<<< HEAD
=======
>>>>>>> origin/main
```

Cuando termines:

```bash
git add attendance-web/src/app/attendance-list.component.ts attendance-web/src/app/attendance.service.ts backend/main.go
git rebase --continue
```

Repite hasta terminar el rebase.

## 3) Validar que quedó bien

```bash
cd attendance-web && npm run build
cd ../backend && go test ./...
```

## 4) Subir la rama

```bash
git push --force-with-lease origin <tu-rama>
```

> `--force-with-lease` es normal después de `rebase`.

---

## Si prefieres merge en lugar de rebase

```bash
git fetch origin
git checkout <tu-rama>
git merge origin/main
# resolver conflictos, luego:
git add .
git commit
git push origin <tu-rama>
```

---

## Nota importante de este proyecto

- En frontend, `attendance-list.component.ts` ya está ajustado para evitar error SSR/prerender (`/api/attendance`) al hacer build.
- Si te vuelve a salir conflicto en ese archivo, conserva la parte de `isPlatformBrowser(...)` dentro de `ngOnInit()`.


## Opción rápida (script)

```bash
./scripts/sync_and_push_branch.sh origin main safe
```

Modo `safe`: fetch + rebase (`-X theirs`) + build frontend + tests backend + push `--force-with-lease`.

Si solo quieres subir YA el avance (sin pruebas locales):

```bash
./scripts/sync_and_push_branch.sh origin main push-only
```

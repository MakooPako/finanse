# Finanse

Prywatny dashboard domowego budżetu. Strona działa na GitHub Pages, a dane pochodzą z arkusza Google przez skrypt Apps Script.

**W tym repozytorium nie ma żadnych danych.** Kwoty, kategorie i klucz dostępu są tylko w arkuszu właściciela i na jego urządzeniach.

## Jak to działa

- `index.html`: cała aplikacja (wygląd, wykresy, formularze), bez zewnętrznych bibliotek.
- `apps-script/Code.gs`: skrypt podpięty do arkusza. Czyta arkusz, liczy prognozy i zapisuje wpisy. Odpowiada tylko na zapytania z poprawnym kluczem.
- `manifest.webmanifest`, `sw.js`, `icons/`: instalacja jako aplikacja na telefonie i komputerze, praca bez internetu z ostatnimi danymi.

Strona wysyła do skryptu `POST` z przepustką urządzenia w treści zapytania (nie w adresie).

**Dostęp:**
- Główny klucz (`utworzKlucz`) służy tylko do połączenia pierwszego urządzenia i nie zostaje w przeglądarce.
- Każde urządzenie dostaje własną przepustkę. W arkuszu, w zakładce „Urządzenia”, zapisany jest tylko jej skrót SHA-256.
- Kolejne urządzenia łączysz 6-cyfrowym kodem (ważny 5 minut, jednorazowy).
- Lista urządzeń, historia i usuwanie: w aplikacji, Plan → Urządzenia. Usunięte urządzenie traci dostęp od razu.
- Awaryjnie: funkcja `odlaczWszystkieUrzadzenia` w Apps Script odcina wszystkie urządzenia.

## Uruchomienie u siebie

1. W arkuszu: Rozszerzenia → Apps Script, wklej `apps-script/Code.gs`.
2. Uruchom funkcję `utworzKlucz` i skopiuj klucz z dziennika wykonania.
3. Wdróż → Nowe wdrożenie → Aplikacja internetowa. Wykonaj jako: Ja. Kto ma dostęp: Każdy. Skopiuj adres kończący się na `/exec`.
4. Otwórz stronę aplikacji, wybierz „Klucz”, wklej adres i klucz.
5. Kolejne urządzenia łączysz kodem: Plan → To urządzenie → Połącz nowe urządzenie.

Nowy klucz (`utworzKlucz`) od razu wyłącza stary na wszystkich urządzeniach.

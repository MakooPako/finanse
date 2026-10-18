# Finanse

Prywatny dashboard domowego budżetu. Strona działa na GitHub Pages, a dane pochodzą z arkusza Google przez skrypt Apps Script.

**W tym repozytorium nie ma żadnych danych.** Kwoty, kategorie i klucz dostępu są tylko w arkuszu właściciela i na jego urządzeniach.

## Jak to działa

- `index.html`, `styles.css`, `app.js`: aplikacja (wygląd, wykresy, formularze), bez zewnętrznych bibliotek.
- `config.js`: adres skryptu Apps Script (sam adres nic nie zdradza, bez przepustki skrypt nie zwraca danych).
- `apps-script/Code.gs`: skrypt podpięty do arkusza. Czyta arkusz, liczy prognozy i zapisuje wpisy. Odpowiada tylko na zapytania z poprawnym kluczem.
- `manifest.webmanifest`, `sw.js`, `icons/`: instalacja jako aplikacja na telefonie i komputerze, praca bez internetu z ostatnimi danymi.

Strona wysyła do skryptu `POST` z przepustką urządzenia w treści zapytania (nie w adresie).

**Dostęp:**
- Główny klucz (`utworzKlucz`) służy tylko do połączenia pierwszego urządzenia i nie zostaje w przeglądarce.
- Każde urządzenie dostaje własną przepustkę. W arkuszu, w zakładce „Urządzenia”, zapisany jest tylko jej skrót SHA-256.
- Kolejne urządzenia łączysz 6-cyfrowym kodem (ważny 5 minut, jednorazowy).
- Lista urządzeń, historia i usuwanie: w aplikacji, ikona zębatki → Ustawienia. Usunięte urządzenie traci dostęp od razu.
- Awaryjnie: funkcja `odlaczWszystkieUrzadzenia` w Apps Script odcina wszystkie urządzenia.

## Uruchomienie u siebie

1. W arkuszu: Rozszerzenia → Apps Script, wklej `apps-script/Code.gs`.
2. Uruchom funkcję `utworzKlucz` i skopiuj klucz z dziennika wykonania.
3. Wdróż → Nowe wdrożenie → Aplikacja internetowa. Wykonaj jako: Ja. Kto ma dostęp: Każdy. Skopiuj adres kończący się na `/exec`.
4. Otwórz stronę aplikacji, wybierz „Klucz”, wklej adres i klucz.
5. Kolejne urządzenia łączysz kodem: ikona zębatki → Połącz nowe.

Nowy klucz (`utworzKlucz`) od razu unieważnia stary. Już połączone urządzenia działają dalej na swoich przepustkach.

**Subskrypcje:** płatność z zaznaczonym „Pobiera się samo” (kolumna K w tabeli płatności) nie wymaga przycisku „Zapłać”. W dniu pobrania aplikacja pyta „Pobrało się?” i po odpowiedzi „Tak” wpisuje kwotę do arkusza.

**Przypomnienia:** po włączeniu w Ustawieniach skrypt prowadzi kalendarz Google „Finanse – płatności” z terminami płatności. Za pierwszym razem uruchom w Apps Script funkcję `wlaczPrzypomnienia`, żeby nadać dostęp do Kalendarza.

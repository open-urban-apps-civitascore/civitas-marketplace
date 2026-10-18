import { describe, expect, it } from 'vitest'

import { isNewerVersion, shareProgress, takenOutNotice, turnLabel } from '@/lib/export/share-stages'

const verified = { state: 'verified' as const, mergedMrUrl: 'https://gitlab.example/mr/1' }

describe('shareProgress', () => {
    it('starts with the person proposing the package', () => {
        const progress = shareProgress({})
        expect(progress.states).toEqual({ propose: 'current', review: 'later', catalog: 'later', listing: 'later' })
        expect(turnLabel(progress)).toBe('Du bist dran')
        expect(progress.finished).toBe(false)
    })

    it('waits for the repository reviewers once the package is proposed', () => {
        for (const facts of [{ bundle: { state: 'mr-open' as const } }, { bundleMrState: 'opened' }]) {
            const progress = shareProgress(facts)
            expect(progress.states.review).toBe('waiting')
            expect(progress.active).toBe('review')
            expect(turnLabel(progress)).toBe('Prüfende im Repository')
        }
    })

    it('hands back to the person after the merge, for the catalogue entry', () => {
        const progress = shareProgress({ bundleMrState: 'merged', bundle: { state: 'on-base', verification: verified }, catalog: { state: 'none' } })
        expect(progress.states).toEqual({ propose: 'done', review: 'done', catalog: 'current', listing: 'later' })
        expect(progress.summary).toBe('Paket gemergt - jetzt in den Katalog eintragen')
        expect(turnLabel(progress)).toBe('Du bist dran')
    })

    it('waits for the catalogue reviewers, then is finished', () => {
        const waiting = shareProgress({ bundle: { state: 'on-base', verification: verified }, catalog: { state: 'mr-open', mrUrl: 'u' } })
        expect(waiting.states.listing).toBe('waiting')
        expect(turnLabel(waiting)).toBe('Prüfende im Katalog')
        const listed = shareProgress({ bundle: { state: 'on-base', verification: verified }, catalog: { state: 'listed' } })
        expect(listed.finished).toBe(true)
        expect(listed.active).toBeUndefined()
        expect(turnLabel(listed)).toBeUndefined()
    })

    it('stops at the catalogue step, with the reason, when the merged state cannot be confirmed', () => {
        const progress = shareProgress({ bundle: { state: 'on-base', verification: { state: 'changed-after-merge' } }, catalog: { state: 'none' } })
        expect(progress.states.catalog).toBe('blocked')
        expect(progress.blockedBy).toContain('nach dem Merge geändert')
        expect(turnLabel(progress)).toBe('Du bist dran')
    })

    it('blames nobody on the page when no catalogue is set up', () => {
        const progress = shareProgress({ bundle: { state: 'on-base', verification: verified }, catalog: { state: 'unconfigured' } })
        expect(progress.states.catalog).toBe('blocked')
        expect(turnLabel(progress)).toBeUndefined()
    })

    it('counts a version replaced by a NEWER one, or closed, as finished', () => {
        const replaced = shareProgress({
            version: '1.0.0',
            bundleMrState: 'merged',
            bundle: { state: 'none', reason: 'other-version', onBase: { id: 'urn:x:usecase:a', version: '1.1.0' } },
        })
        expect(replaced.finished).toBe(true)
        expect(replaced.summary).toBe('Durch Version 1.1.0 ersetzt')
        expect(shareProgress({ bundleMrState: 'closed' }).finished).toBe(true)
    })

    it('asks nobody for a move when a merged package is missing or older on the base branch, and says why', () => {
        const missing = shareProgress({ version: '1.0.0', bundleMrState: 'merged', bundle: { state: 'none', reason: 'no-package' } })
        expect(missing.finished).toBe(true)
        expect(missing.states.catalog).toBe('blocked')
        expect(missing.blockedBy).toContain('nicht mehr im Repository')
        expect(missing.summary).toBe('Paket gemergt, aber nicht im Repository')
        expect(turnLabel(missing)).toBeUndefined()

        const older = shareProgress({
            version: '1.1.0',
            bundleMrState: 'merged',
            bundle: { state: 'none', reason: 'other-version', onBase: { id: 'urn:x:usecase:a', version: '1.0.0' } },
        })
        expect(older.finished).toBe(true)
        expect(older.blockedBy).toContain('1.0.0 statt 1.1.0')

        const noBranch = shareProgress({ bundleMrState: 'merged', bundle: { state: 'none', reason: 'no-base-branch', detail: 'Branch main existiert nicht' } })
        expect(noBranch.blockedBy).toBe('Branch main existiert nicht')
    })

    it('names a merge request the marketplace closed itself as withdrawn', () => {
        expect(shareProgress({ bundleMrState: 'closed', withdrawn: true })).toMatchObject({ finished: true, summary: 'Zurückgezogen' })
        expect(shareProgress({ bundleMrState: 'closed' }).summary).toBe('Merge Request ohne Merge geschlossen')
    })

    it('is finished with a version the catalogue team took out, and offers no catalogue step for it', () => {
        const deleted = shareProgress({ version: '1.0.2', bundleMrState: 'merged', bundle: { state: 'on-base', verification: verified }, catalog: { state: 'withdrawn', takenOut: { version: '1.0.2' } } })
        expect(deleted).toMatchObject({ finished: true, summary: 'Aus dem Katalog genommen' })
        expect(deleted.states.catalog).toBe('blocked')
        expect(deleted.active).toBeUndefined()
        expect(turnLabel(deleted)).toBeUndefined()

        const revoked = shareProgress({
            version: '1.0.2',
            bundleMrState: 'merged',
            // Even a package changed after the merge does not ask for a look any more.
            bundle: { state: 'on-base', verification: { state: 'changed-after-merge' } },
            catalog: { state: 'withdrawn', takenOut: { version: '1.0.2', reason: 'Datenquelle abgeschaltet.' } },
        })
        expect(revoked).toMatchObject({ finished: true, summary: 'Aus dem Katalog genommen - Datenquelle abgeschaltet' })
        expect(revoked.blockedBy).toBe('Diese Version kommt nicht noch einmal in den Katalog.')

        // A revoked row shuts out the whole entry: a higher version was never there, so "nicht noch einmal" would be wrong.
        const wholeEntry = shareProgress({ version: '1.1.0', bundleMrState: 'merged', bundle: { state: 'on-base', verification: verified }, catalog: { state: 'withdrawn', takenOut: { version: '1.0.2' } } })
        expect(wholeEntry).toMatchObject({ finished: true, summary: 'Aus dem Katalog genommen' })
        expect(wholeEntry.blockedBy).toBe('Herausgenommen ist der ganze Eintrag: auch eine neue Version kommt erst in den Katalog, wenn das Katalog-Team ihn wieder freigibt.')
    })

    it('asks the person to withdraw an open proposal that would bring a taken-out version back', () => {
        const progress = shareProgress({
            version: '1.0.2',
            bundleMrState: 'merged',
            bundle: { state: 'on-base', verification: verified },
            catalog: { state: 'mr-open', mrUrl: 'u/27', takenOut: { version: '1.0.2' }, bringsBack: true },
        })
        expect(progress).toMatchObject({ finished: false, active: 'listing', turn: 'you', summary: 'Katalog-Eintrag in Prüfung - bringt einen herausgenommenen Eintrag zurück' })
        expect(progress.states.listing).toBe('blocked')
        expect(turnLabel(progress)).toBe('Du bist dran')
    })

    it('does not offer to propose a version again that was in the catalogue, but does a higher one', () => {
        const usedUp = shareProgress({ version: '1.0.2', catalog: { state: 'withdrawn', takenOut: { version: '1.0.2' } } })
        expect(usedUp).toMatchObject({ finished: true, summary: 'Aus dem Katalog genommen' })
        expect(usedUp.states.propose).toBe('blocked')
        const higher = shareProgress({ version: '1.1.0', catalog: { state: 'none', takenOut: { version: '1.0.2' } } })
        expect(higher.states.propose).toBe('current')
    })

    it('tells who took a version out, why, and what to do before the next one', () => {
        expect(takenOutNotice({ version: '1.0.2' })).toBe('Das Katalog-Team hat Version 1.0.2 aus dem Katalog genommen. Frag dort nach, bevor du eine neue Version teilst.')
        // One full stop, whether or not the reason brings its own.
        for (const reason of ['Datenquelle abgeschaltet', 'Datenquelle abgeschaltet.']) {
            expect(takenOutNotice({ version: '1.0.2', reason })).toBe(
                'Das Katalog-Team hat Version 1.0.2 aus dem Katalog genommen. Grund: Datenquelle abgeschaltet. Frag dort nach, bevor du eine neue Version teilst.',
            )
        }
    })

    it('waits for the repository reviewers while a removal is proposed, instead of asking for the catalogue entry', () => {
        const progress = shareProgress({
            bundleMrState: 'merged',
            bundle: { state: 'on-base', verification: verified, removal: { state: 'opened', mrUrl: 'u/remove' } },
            catalog: { state: 'none' },
        })
        expect(progress).toMatchObject({ removal: 'pending', finished: false, summary: 'Entfernen wartet auf Prüfung' })
        expect(progress.active).toBeUndefined()
        expect(progress.states.catalog).toBe('later')
        expect(turnLabel(progress)).toBe('Prüfende im Repository')
    })

    it('is finished once the removal is merged and the version gone, and back when it was shared again', () => {
        const removed = shareProgress({
            version: '1.0.0',
            bundleMrState: 'merged',
            bundle: { state: 'none', reason: 'no-package', removal: { state: 'merged', mrUrl: 'u/remove' } },
        })
        expect(removed).toMatchObject({ removal: 'done', finished: true, summary: 'Aus dem Repository entfernt' })
        expect(turnLabel(removed)).toBeUndefined()

        const back = shareProgress({
            bundleMrState: 'merged',
            bundle: { state: 'on-base', verification: verified, removal: { state: 'merged', mrUrl: 'u/remove' } },
            catalog: { state: 'none' },
        })
        expect(back.states.catalog).toBe('current')
        expect(back.removal).toBeUndefined()

        // A new proposal of the version: the removal is history, whatever its state.
        const proposedAgain = shareProgress({ bundle: { state: 'mr-open' } })
        expect(proposedAgain.active).toBe('review')
        expect(proposedAgain.removal).toBeUndefined()
    })

    it('compares plain versions only', () => {
        expect(isNewerVersion('1.10.0', '1.9.3')).toBe(true)
        expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false)
        expect(isNewerVersion('0.9.9', '1.0.0')).toBe(false)
        expect(isNewerVersion('2.0.0-rc.1', '1.0.0')).toBe(false)
    })
})

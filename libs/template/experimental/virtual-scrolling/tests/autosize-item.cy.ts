import { NgIf } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  Injectable,
  Input,
  input,
  output,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { createOutputSpy, mount } from 'cypress/angular';
import { BehaviorSubject, Subject } from 'rxjs';
import {
  AutoSizeVirtualScrollStrategy,
  ListRange,
  RxVirtualFor,
  RxVirtualScrollElementDirective,
  RxVirtualScrollViewportComponent,
  RxVirtualScrollWindowDirective,
} from '../src';
import { getViewportComponent } from './fixtures';

export function randomContent(minLength = 1, maxLength = 50) {
  return new Array(Math.max(minLength, Math.floor(Math.random() * maxLength)))
    .fill('')
    .map(() => randomWord())
    .join(' ');
}

function randomWord() {
  const words = [
    'Apple',
    'Banana',
    'The',
    'Orange',
    'House',
    'Boat',
    'Lake',
    'Car',
    'And',
  ];
  return words[Math.floor(Math.random() * words.length)];
}

export interface Item {
  id: string;
  content: string;
  description: string;
  imageHeight: number;
}

export function randomNumber(min: number, max: number) {
  return Math.max(min, Math.floor(Math.random() * max));
}

export function generateItems(amount: number): Item[] {
  return new Array(amount).fill(0).map(() => {
    return {
      id: crypto.randomUUID(),
      content: randomContent(),
      description: randomContent(100, 150),
      imageHeight: randomNumber(10, 111),
    };
  });
}

@Injectable()
class AutoSizeDataSourceService {
  items$ = new BehaviorSubject<Item[]>([]);
  selectedIndex$ = new BehaviorSubject<number | undefined>(undefined);

  removeAtIndex(index: number) {
    const currentState = this.items$.getValue();
    const newState = [...currentState];
    newState.splice(index, 1);
    this.items$.next(newState);
  }

  selectIndex(index: number | undefined) {
    this.selectedIndex$.next(index);
  }
}

@Component({
  selector: 'rx-auto-size-item',
  template: `<div>
    <h3>{{ index() }}</h3>
    @if (item(); as item) {
      <p>{{ item.id }}</p>
      <p>{{ item.description }}</p>
      <img
        [attr.height]="item.imageHeight"
        src="assets/big/doom-hunter-2.png"
      />
    }
    <div class="actions">
      <button (click)="removeMe()">Remove</button>
    </div>
  </div>`,
  host: {
    '(click)': 'onClick()',
    '[class.selected]': 'selected()',
    '[attr.data-cy-item-id]': 'itemId()',
  },
  styles: [
    `
      .actions {
        border: 1px solid green;
        padding: 5px;
        gap: 5px;
        display: flex;
      }
      /** hack to alter height on selection */
      :host {
        &.selected {
          .actions {
            border: 2px solid red;
          }
        }
      }
    `,
  ],

  changeDetection: ChangeDetectionStrategy.OnPush,
})
class AutoSizeItemComponent {
  private readonly dataSource = inject(AutoSizeDataSourceService);

  index = input.required<number>();
  item = input.required<Item>();

  selectedIndex = toSignal(this.dataSource.selectedIndex$);

  selected = computed(() => {
    const selectedIndex = this.selectedIndex();
    return selectedIndex === this.index();
  });

  itemId = computed(() => {
    return this.item().id;
  });

  removeMe() {
    this.dataSource.removeAtIndex(this.index());
  }

  onClick() {
    this.dataSource.selectIndex(this.index());
  }
}

@Component({
  template: `<rx-virtual-scroll-viewport
    data-cy="viewport"
    [style.height.px]="containerHeight"
    [runwayItems]="runwayItems"
    [runwayItemsOpposite]="runwayItemsOpposite"
    [tombstoneSize]="tombstoneSize"
    (scrolledIndexChange)="scrolledIndex.emit($event)"
    (viewRange)="viewRange.emit($event)"
    [keepScrolledIndexOnPrepend]="true"
    autosize
  >
    <div
      *rxVirtualFor="
        let item of items$;
        let index = index;
        renderCallback: renderCallback;
        templateCacheSize: viewCache;
        strategy: strategy;
        trackBy: trackBy
      "
      [attr.data-cy]="'item'"
      [attr.data-cy-item-idx]="index"
    >
      <rx-auto-size-item [index]="index" [item]="item" />
    </div>
  </rx-virtual-scroll-viewport>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RxVirtualScrollViewportComponent,
    RxVirtualFor,
    AutoSizeVirtualScrollStrategy,
    RxVirtualScrollWindowDirective,
    RxVirtualScrollElementDirective,
    NgIf,
    AutoSizeItemComponent,
  ],
  providers: [AutoSizeDataSourceService],
})
class AutoSizeParentComponent {
  private readonly dataSource = inject(AutoSizeDataSourceService);
  readonly items$ = this.dataSource.items$;

  containerHeight = 600;
  strategy = 'normal';
  viewCache = 20;

  runwayItems = 10;
  runwayItemsOpposite = 10;
  tombstoneSize = 50;

  trackBy(_index: number, item: Item) {
    return item.id;
  }

  @Input() renderCallback: Subject<any>;
  viewRange = output<ListRange>();
  scrolledIndex = output<number>();
}

describe('AutoSizeItem', () => {
  /**
   * Case:
   * When removing item at bottom of the items, scrollTo is triggered, sets isStable$ to false
   * no scroll happens, removed item stays visible until user scrolls manually
   */
  it('removes last item at bottom of viewport', () => {
    const items = generateItems(100);

    mount(AutoSizeParentComponent, {
      componentProperties: {
        scrolledIndex: createOutputSpy<number>('scrolledIndex'),
      },
    }).then(({ fixture }) => {
      fixture.detectChanges();

      const dataSourceService = fixture.componentRef.injector.get(
        AutoSizeDataSourceService,
      );

      dataSourceService.items$.next(items);

      // last item
      const scrollIndex = items.length - 1;
      const itemToRemove = items[scrollIndex];

      const viewportComponent = getViewportComponent(fixture);

      viewportComponent.scrollToIndex(scrollIndex);

      // @scrolledIndex output is based on top anchor item, assert we are within
      cy.get('@scrolledIndex')
        .its('lastCall.args.0')
        .should('be.within', scrollIndex - 2, scrollIndex);

      cy.get('[data-cy=item]')
        .last()
        .then((item) => {
          expect(item.text().trim()).to.contain('99');
        });

      cy.get(`[data-cy-item-idx=${scrollIndex}]`).within(() => {
        cy.contains('button', 'Remove').focus().click();
      });

      // assert we have removed the item
      cy.get(`[data-cy-item-id=${itemToRemove.id}]`).should('not.exist');

      // last item after removing should now be 98
      cy.get('[data-cy=item]')
        .last()
        .then((item) => {
          expect(item.text().trim()).to.contain('98');
        });
    });
  });

  /**
   * Case:
   * When removing an item anywhere in the items and a resize event is observed concurrently
   * this results in `positionByResizeObserver$` attempting to access and update `this._virtualItems[index]` on undefined
   * Results in `Uncaught TypeError: Cannot read properties of undefined (reading 'size')`
   *
   * Have observed various cases which can cause this - most stem from removing an item while a resize happens concurrently.
   * If your virtual items lookup their own data from a Observable / signal store rather than though the item itelf, changes to the items can occour outside of the items lifecycle.
   *
   * related issues:
   * - https://github.com/rx-angular/rx-angular/issues/1871
   * - https://github.com/rx-angular/rx-angular/issues/1878
   */
  it('removes item while resizing - size of undefined', () => {
    const items = generateItems(100);

    mount(AutoSizeParentComponent, {
      componentProperties: {
        scrolledIndex: createOutputSpy<number>('scrolledIndex'),
      },
    }).then(({ fixture }) => {
      fixture.detectChanges();

      const dataSourceService = fixture.componentRef.injector.get(
        AutoSizeDataSourceService,
      );

      dataSourceService.items$.next(items);

      // last item
      const scrollIndex = items.length - 1;

      const viewportComponent = getViewportComponent(fixture);

      viewportComponent.scrollToIndex(scrollIndex, 'instant');

      // @scrolledIndex output is based on top anchor item, assert we are within
      cy.get('@scrolledIndex')
        .its('lastCall.args.0')
        .should('be.within', scrollIndex - 2, scrollIndex);

      cy.get('[data-cy=item]')
        .last()
        .then((item) => {
          expect(item.text().trim()).to.contain('99');
        });

      // attempt to make the previous items height change by setting selected
      cy.get(`[data-cy-item-idx=${scrollIndex - 1}]`).click();
      cy.get(`[data-cy-item-idx=${scrollIndex}]`).within(() => {
        cy.contains('button', 'Remove').focus().click();
      });

      cy.get('[data-cy=item]')
        .last()
        .then((item) => {
          expect(item.text().trim()).to.contain('98');
        });
    });
  });

  /**
   * Case:
   * When removing an item at the bottom of the items. I.e, length 100, we remove 96, the viewport scrolls to the very bottom
   */
  it('removes third item from bottom of viewport without scrolling to bottom', () => {
    const items = generateItems(100);

    mount(AutoSizeParentComponent, {
      componentProperties: {
        scrolledIndex: createOutputSpy<number>('scrolledIndex'),
      },
    }).then(({ fixture }) => {
      fixture.detectChanges();

      const dataSourceService = fixture.componentRef.injector.get(
        AutoSizeDataSourceService,
      );

      dataSourceService.items$.next(items);

      const indexToRemove = 96;
      const itemToRemove = { ...items[indexToRemove] };
      const itemBelow = { ...items[indexToRemove + 1] };

      const viewportComponent = getViewportComponent(fixture);

      viewportComponent.scrollToIndex(indexToRemove);

      // @scrolledIndex output is based on top anchor item, assert we are within
      cy.get('@scrolledIndex').should('have.been.called');
      cy.get('@scrolledIndex')
        .its('lastCall.args.0')
        .should('eq', indexToRemove);

      // remove the item
      cy.get(`[data-cy-item-idx=${indexToRemove}]`).within(() => {
        cy.contains('button', 'Remove').focus().click();
      });

      // assert we have removed the item
      cy.get(`[data-cy-item-id=${itemToRemove.id}]`).should('not.exist');

      // assert the removedIndex, now contains the itemBelow
      cy.get(`[data-cy-item-idx=${indexToRemove}]`).within((i) => {
        expect(i.text().trim()).to.contain(itemBelow.id);
      });

      cy.get('@scrolledIndex').should('have.been.called');
      cy.get('@scrolledIndex')
        .its('lastCall.args.0')
        .should('eq', indexToRemove);
    });
  });
});

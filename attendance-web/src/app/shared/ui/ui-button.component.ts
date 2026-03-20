import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'ui-button',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './ui-button.component.html',
  styleUrl: './ui-button.component.scss',
})
export class UiButtonComponent {
  @Input() disabled = false;
  @Input() small = false;
  @Input() danger = false;
  @Input() sectionToggle = false;
  @Input() sessionTrigger = false;
  @Input() title = '';
  @Input() type: 'button' | 'submit' | 'reset' = 'button';

  @Output() pressed = new EventEmitter<MouseEvent>();
  @Output() mouseDown = new EventEmitter<MouseEvent>();

  onClick(event: MouseEvent): void {
    if (this.disabled) {
      event.preventDefault();
      return;
    }
    this.pressed.emit(event);
  }

  onMouseDown(event: MouseEvent): void {
    this.mouseDown.emit(event);
  }
}

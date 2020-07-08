(define-syntax -concat-name
  [(-concat-name ?a ?b) (string->symbol (string-append (symbol->string '?a) (symbol->string '?b)))]
)

(define-syntax -symbol-alist
  [(-symbol-alist ?n ?a . ?b) (cons (list '?a ?n) (-symbol-alist (+ ?n 1) . ?b))]
  [(-symbol-alist ?n) '()])

(define (-define-propgetx name prop index)
  (list 'define (list (string->symbol (string-append (symbol->string name) "-" (symbol->string prop))) 'x) (list 'list-ref 'x index))
)

(define-syntax define-struct
  [(define-struct ?name ?props) (begin
     (eval (list 'define (-concat-name make- ?name) '(lambda ?props (list '?name . ?props))))
     (eval (list 'define (-concat-name ?name ?) '(lambda (x) (and (eq? (car x) '?name) (= (length '?props) (length (cdr x)))))))
     (for-each (lambda (p)
       (eval (apply (lambda (prop x) (-define-propgetx '?name prop x)) p))
     ) (-symbol-alist 1 . ?props))
  )]
)

(define-struct posn [x y])
